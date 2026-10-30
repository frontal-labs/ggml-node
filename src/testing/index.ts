// M1 stub: testing utilities land in M6. This module must never import node-llama-cpp.
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { Inboard } from "@/core/types.js";

export interface MockInboardOptions {
  respond?:
    | string
    | string[]
    | ((req: { messages: { role: string; content: string }[] }) => string);
  delayMs?: number;
  tokensPerChunk?: number;
}

export function createMockInboard(_options: MockInboardOptions): Inboard {
  throw new Error("inboard/testing: not implemented yet (M6)");
}

export function mockModel(_options: { respond: string | string[] }): LanguageModelV4 {
  throw new Error("inboard/testing: not implemented yet (M6)");
}
