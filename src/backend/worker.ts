import { createLlamaCppBackend } from "@/backend/llama-cpp.js";
import type { HostMessage, WireError, WorkerMessage } from "@/backend/protocol.js";
import { GgmlNodeError, isGgmlNodeError } from "@/core/errors.js";
import type { Backend, JsonGrammar } from "@/types.js";

/**
 * The worker side of process isolation. It owns one backend and answers the host's requests. If the
 * worker dies, only the host's in-flight requests fail, and the host starts a fresh worker.
 *
 * `factory` is injectable so tests can run the same protocol with a fake backend.
 */
export function runWorker(factory: () => Backend = createLlamaCppBackend): void {
  let backend: Backend | undefined;
  const grammars = new Map<string, JsonGrammar>();
  const controllers = new Map<number, AbortController>();
  const abortable = async <T>(id: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    controllers.set(id, controller);
    try {
      return await run(controller.signal);
    } finally {
      controllers.delete(id);
    }
  };

  const reply = (message: WorkerMessage) => {
    if (process.send) {
      process.send(message);
    }
  };
  const fail = (id: number, err: unknown) => {
    const error = toWire(err);
    reply({ error, id, ok: false, type: "reply" });
  };
  const current = (): Backend => {
    if (!backend) {
      throw new GgmlNodeError("INVALID_OPTIONS", "The worker has no model loaded", {
        hint: "Call ready() before generating.",
      });
    }
    return backend;
  };

  async function handle(message: HostMessage): Promise<void> {
    switch (message.type) {
      case "load": {
        backend ??= factory();
        const result = await backend.load(message.options);
        reply({ id: message.id, ok: true, result, type: "reply" });
        return;
      }
      case "count": {
        const result = await current().countTokens(message.text);
        reply({ id: message.id, ok: true, result, type: "reply" });
        return;
      }
      case "countPrompt": {
        const result = await current().countPromptTokens(message.messages);
        reply({ id: message.id, ok: true, result, type: "reply" });
        return;
      }
      case "embed": {
        const result = await abortable(message.id, (signal) =>
          current().embed(message.inputs, signal),
        );
        reply({ id: message.id, ok: true, result, type: "reply" });
        return;
      }
      case "buildGrammar": {
        const grammar = await current().buildJsonGrammar(message.schema);
        grammars.set(message.key, grammar);
        reply({ id: message.id, ok: true, result: grammar, type: "reply" });
        return;
      }
      case "generate": {
        const controller = new AbortController();
        controllers.set(message.id, controller);
        try {
          const grammar = await grammarFor(message);
          const result = await current().generate(
            message.sequence,
            {
              ...message.request,
              signal: controller.signal,
              ...(grammar ? { grammar } : {}),
            },
            (text) => reply({ id: message.id, text, type: "delta" }),
          );
          reply({ id: message.id, ok: true, result, type: "reply" });
        } finally {
          controllers.delete(message.id);
        }
        return;
      }
      case "abort":
        controllers.get(message.target)?.abort();
        return;
      case "reset":
        await current().resetSequence(message.sequence);
        reply({ id: message.id, ok: true, type: "reply" });
        return;
      case "unload":
        await backend?.unload();
        backend = undefined;
        grammars.clear();
        reply({ id: message.id, ok: true, type: "reply" });
        return;
      default:
        // Every HostMessage type is handled above. An unknown type from a newer host is ignored.
        return;
    }
  }

  async function grammarFor(
    message: Extract<HostMessage, { type: "generate" }>,
  ): Promise<JsonGrammar | undefined> {
    if (!(message.schema && message.grammarKey)) {
      return undefined;
    }
    const cached = grammars.get(message.grammarKey);
    if (cached) {
      return cached;
    }
    const grammar = await current().buildJsonGrammar(message.schema);
    grammars.set(message.grammarKey, grammar);
    return grammar;
  }

  process.on("message", (raw: unknown) => {
    const message = raw as HostMessage;
    handle(message).catch((err: unknown) => {
      const id = "id" in message ? message.id : message.target;
      fail(id, err);
    });
  });
  // The host went away: stop instead of leaving a model loaded in the background.
  process.on("disconnect", () => {
    process.exit(0);
  });
}

function toWire(err: unknown): WireError {
  if (isGgmlNodeError(err)) {
    return { code: err.code, hint: err.hint, message: err.message };
  }
  return {
    code: "BACKEND_CRASHED",
    hint: "Run: npx ggml-node doctor. If this persists, report it with the stack trace.",
    message: err instanceof Error ? err.message : String(err),
  };
}
