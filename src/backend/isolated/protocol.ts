import type { BackendLoadOptions, BackendRequest } from "@/backend/types.js";
import type { NodeSlmErrorCode } from "@/core/errors.js";
import type { JsonSchemaObject, Message } from "@/core/types.js";

/**
 * Typed IPC protocol between the host (parent process) and the worker (child process that owns the
 * native backend). Messages are JSON, so every payload is plain data.
 */

export type RequestId = number;

/** Host to worker. */
export type HostMessage =
  | { type: "load"; id: RequestId; options: BackendLoadOptions }
  | { type: "count"; id: RequestId; text: string }
  | { type: "countPrompt"; id: RequestId; messages: Message[] }
  | {
      type: "generate";
      id: RequestId;
      sequence: number;
      request: Omit<BackendRequest, "signal" | "grammar">;
      /** The JSON Schema the grammar is built from, when the request is structured. */
      schema?: JsonSchemaObject | undefined;
      grammarKey?: string | undefined;
    }
  | { type: "abort"; target: RequestId }
  | { type: "reset"; id: RequestId; sequence: number }
  | { type: "buildGrammar"; id: RequestId; schema: JsonSchemaObject; key: string }
  | { type: "unload"; id: RequestId };

export interface WireError {
  code: NodeSlmErrorCode;
  hint: string;
  message: string;
}

/** Worker to host. */
export type WorkerMessage =
  | { type: "reply"; id: RequestId; ok: true; result?: unknown }
  | { type: "reply"; id: RequestId; ok: false; error: WireError }
  | { type: "delta"; id: RequestId; text: string };
