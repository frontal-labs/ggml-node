import { expectTypeOf } from "vitest";
import { z } from "zod";
import { createInboard, type GenerateResult, type Inboard, type ObjectResult } from "@/index.js";
import type { ModelId } from "@/registry/models.js";

/**
 * Compile-time assertions for the Section 3 contract. `tsc` (bun run typecheck) checks
 * them. The function is exported but never called at runtime, so the M1 stubs never run.
 */
export async function assertPublicTypes(): Promise<void> {
  expectTypeOf<ModelId>().toEqualTypeOf<"qwen2.5-0.5b" | "qwen2.5-1.5b" | "smollm2-360m">();

  // @ts-expect-error not a registry model
  createInboard({ model: "gpt-4o" });
  createInboard({ model: "qwen2.5-0.5b" });
  createInboard({ model: { path: "./models/custom.gguf" } });
  // @ts-expect-error maxTokens is not an InboardOptions field
  createInboard({ maxTokens: 10, model: "qwen2.5-0.5b" });

  const ai = null as unknown as Inboard;
  expectTypeOf(ai.generate).returns.resolves.toEqualTypeOf<GenerateResult>();
  expectTypeOf(ai.countTokens).returns.resolves.toEqualTypeOf<number>();
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
  createInboard({ contextSize: undefined, model: "qwen2.5-0.5b" });
}
