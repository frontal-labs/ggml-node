import { expectTypeOf } from "vitest";
import { z } from "zod";
import {
  createGgmlNode,
  type EmbedResult,
  type GenerateResult,
  type GgmlNode,
  type ModelInfo,
  type ObjectResult,
} from "@/index.js";
import type { ModelId } from "@/registry/models.js";

/**
 * Compile-time assertions for the Section 3 contract. `tsc` (bun run typecheck) checks
 * them. The function is exported but never called at runtime, so the M1 stubs never run.
 */
export async function assertPublicTypes(): Promise<void> {
  expectTypeOf<ModelId>().toEqualTypeOf<
    "qwen2.5-0.5b" | "qwen2.5-1.5b" | "smollm2-360m" | "bge-small-en-v1.5"
  >();

  // @ts-expect-error not a registry model
  createGgmlNode({ model: "gpt-4o" });
  createGgmlNode({ model: "qwen2.5-0.5b" });
  createGgmlNode({ model: { path: "./models/custom.gguf" } });
  // @ts-expect-error maxTokens is not an GgmlNodeOptions field
  createGgmlNode({ maxTokens: 10, model: "qwen2.5-0.5b" });

  const ai = null as unknown as GgmlNode;
  expectTypeOf(ai.generate).returns.resolves.toEqualTypeOf<GenerateResult>();
  expectTypeOf(ai.countTokens).returns.resolves.toEqualTypeOf<number>();
  expectTypeOf(ai.embed).returns.resolves.toEqualTypeOf<EmbedResult>();
  expectTypeOf(ai.ready).returns.resolves.toEqualTypeOf<ModelInfo>();
  expectTypeOf<ModelInfo["kind"]>().toEqualTypeOf<"generation" | "embedding">();
  expectTypeOf<EmbedResult["embeddings"]>().toEqualTypeOf<number[][]>();

  createGgmlNode({ kind: "embedding", model: { path: "./models/custom.gguf" } });
  // @ts-expect-error kind is one of the two model kinds
  createGgmlNode({ kind: "chat", model: { path: "./models/custom.gguf" } });
  expectTypeOf(ai.unload).returns.resolves.toEqualTypeOf<void>();

  const schema = z.object({ label: z.enum(["spam", "ham"]), score: z.number() });
  const typed = await ai.object({ schema });
  expectTypeOf(typed).toEqualTypeOf<ObjectResult<z.infer<typeof schema>>>();
  expectTypeOf(typed.object.label).toEqualTypeOf<"spam" | "ham">();

  const json = { properties: { name: { type: "string" } }, type: "object" } as const;
  const untyped = await ai.object({ schema: json });
  expectTypeOf(untyped.object).toEqualTypeOf<unknown>();
  const named = await ai.object<{ name: string }>({ schema: json });
  expectTypeOf(named.object).toEqualTypeOf<{ name: string }>();

  // @ts-expect-error exactOptionalPropertyTypes: optional fields reject explicit undefined
  createGgmlNode({ contextSize: undefined, model: "qwen2.5-0.5b" });
}
