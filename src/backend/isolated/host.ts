// biome-ignore-all lint/suspicious/useAwait: Backend methods return promises for one uniform interface
import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { HostMessage, WireError, WorkerMessage } from "@/backend/isolated/protocol.js";
import type {
  Backend,
  BackendLoadOptions,
  BackendLoadResult,
  BackendRequest,
  BackendResult,
  JsonGrammar,
} from "@/backend/types.js";
import { InboardError, type InboardErrorCode } from "@/core/errors.js";
import type { JsonSchemaObject, Message } from "@/core/types.js";

/**
 * Process isolation. The native backend runs in a child process. If the child crashes, the requests
 * in flight fail with `BACKEND_CRASHED`, and the next request starts a fresh child and reloads the
 * model. At most `maxRestarts` restarts happen per window. After that the backend stays failed, with
 * a hint, until the process is restarted.
 */

export interface IsolatedBackendOptions {
  /** Arguments for the worker's Node process, for example `["--import", "tsx"]` under test. */
  execArgv?: string[];
  /** Executable that runs the worker. Defaults to the host's own runtime. */
  execPath?: string;
  maxRestarts?: number;
  restartWindowMs?: number;
  /** The worker entry to fork. Defaults to the built `backend/isolated/worker-main.js`. */
  workerPath?: string;
}

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_WINDOW_MS = 60_000;

/** Live children, stopped when the host process exits. */
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) {
    return;
  }
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const child of liveChildren) {
      child.kill();
    }
  });
}

const defaultWorkerPath = (): string =>
  fileURLToPath(new URL("./backend/isolated/worker-main.js", import.meta.url));

interface Pending {
  onDelta: ((text: string) => void) | undefined;
  reject: (err: unknown) => void;
  resolve: (value: unknown) => void;
}

export function createIsolatedBackend(options: IsolatedBackendOptions = {}): Backend {
  const workerPath = options.workerPath ?? defaultWorkerPath();
  const execArgv = options.execArgv ?? [];
  const execPath = options.execPath ?? process.execPath;
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const windowMs = options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;

  let child: ChildProcess | undefined;
  let starting: Promise<ChildProcess> | undefined;
  let loadOptions: BackendLoadOptions | undefined;
  let spawns = 0;
  const restartTimes: number[] = [];
  let failure: InboardError | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  /** Grammar schemas by cache key. The worker builds each grammar on first use. */
  const schemas = new Map<string, JsonSchemaObject>();

  function onMessage(raw: unknown): void {
    const message = raw as WorkerMessage;
    const waiter = pending.get(message.id);
    if (message.type === "delta") {
      waiter?.onDelta?.(message.text);
      return;
    }
    if (!waiter) {
      return;
    }
    pending.delete(message.id);
    if (message.ok) {
      waiter.resolve(message.result);
    } else {
      waiter.reject(fromWire(message.error));
    }
  }

  function onExit(gone: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    liveChildren.delete(gone);
    if (child === gone) {
      child = undefined;
    }
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(
        new InboardError("BACKEND_CRASHED", `The backend process exited (${reason})`, {
          hint: "The next call starts a new backend and reloads the model.",
        }),
      );
    }
  }

  function checkRestartBudget(): void {
    if (spawns === 0) {
      return;
    }
    const now = Date.now();
    while (restartTimes.length > 0 && now - (restartTimes[0] ?? 0) > windowMs) {
      restartTimes.shift();
    }
    if (restartTimes.length >= maxRestarts) {
      failure = new InboardError(
        "BACKEND_CRASHED",
        `The backend crashed ${maxRestarts} times within ${windowMs / 1000}s`,
        {
          hint: "The backend stays stopped to avoid a crash loop. Fix the cause (the worker's stderr shows it), then restart this process.",
        },
      );
      throw failure;
    }
    restartTimes.push(now);
  }

  function spawn(): ChildProcess {
    checkRestartBudget();
    spawns += 1;
    const forked = fork(workerPath, [], {
      execArgv,
      execPath,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    forked.on("message", onMessage);
    forked.on("exit", (code, signal) => onExit(forked, code, signal));
    forked.on("error", () => onExit(forked, null, null));
    liveChildren.add(forked);
    installExitHook();
    child = forked;
    return forked;
  }

  /** Sends one message and resolves with the worker's reply. */
  function send<T>(
    target: ChildProcess,
    build: (id: number) => HostMessage,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const id = nextId;
    nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => target.send({ target: id, type: "abort" } satisfies HostMessage);
      const settle = () => signal?.removeEventListener("abort", onAbort);
      pending.set(id, {
        onDelta,
        reject: (err) => {
          settle();
          reject(err);
        },
        resolve: (value) => {
          settle();
          resolve(value as T);
        },
      });
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      target.send(build(id));
    });
  }

  /** Returns a live child. Starts one and replays the load when the previous one is gone. */
  function ensureChild(): Promise<ChildProcess> {
    if (failure) {
      return Promise.reject(failure);
    }
    if (child?.connected) {
      return Promise.resolve(child);
    }
    starting ??= (async () => {
      const started = spawn();
      if (loadOptions) {
        const replay = loadOptions;
        await send<BackendLoadResult>(started, (id) => ({ id, options: replay, type: "load" }));
      }
      return started;
    })().finally(() => {
      starting = undefined;
    });
    return starting;
  }

  async function request<T>(
    build: (id: number) => HostMessage,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const target = await ensureChild();
    return send<T>(target, build, onDelta, signal);
  }

  return {
    async buildJsonGrammar(schema: JsonSchemaObject): Promise<JsonGrammar> {
      const key = JSON.stringify(schema);
      schemas.set(key, schema);
      return { key };
    },
    countPromptTokens(messages: Message[]): Promise<number> {
      return request<number>((id) => ({ id, messages, type: "countPrompt" }));
    },
    countTokens(text: string): Promise<number> {
      return request<number>((id) => ({ id, text, type: "count" }));
    },
    generate(
      sequence: number,
      req: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      const { signal, grammar, ...rest } = req;
      const schema = grammar ? schemas.get(grammar.key) : undefined;
      return request<BackendResult>(
        (id) => ({
          id,
          request: rest,
          sequence,
          type: "generate",
          ...(schema && grammar ? { grammarKey: grammar.key, schema } : {}),
        }),
        onDelta,
        signal,
      );
    },
    async load(loadOpts: BackendLoadOptions): Promise<BackendLoadResult> {
      loadOptions = loadOpts;
      return request<BackendLoadResult>((id) => ({ id, options: loadOpts, type: "load" }));
    },
    resetSequence(sequence: number): Promise<void> {
      return request<void>((id) => ({ id, sequence, type: "reset" }));
    },
    async unload(): Promise<void> {
      loadOptions = undefined;
      const current = child;
      if (!current) {
        return;
      }
      try {
        await send<void>(current, (id) => ({ id, type: "unload" }));
      } finally {
        current.kill();
      }
    },
  };
}

function fromWire(error: WireError): InboardError {
  return new InboardError(error.code as InboardErrorCode, error.message, { hint: error.hint });
}
