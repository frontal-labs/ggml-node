// biome-ignore-all lint/suspicious/useAwait: doStream stays async so errors become rejections, as the SDK expects
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
  SharedV4Warning,
} from "@ai-sdk/provider";
import { TinyLLMError } from "@/core/errors.js";
import type { GenerateResult, Message, TinyLLM } from "@/core/types.js";

/**
 * Internal: the `LanguageModelV4` implementation. `src/ai/index.ts` exposes the public API.
 * Tests build models directly from a fake-backed TinyLLM through `languageModelFor`.
 */
export function languageModelFor(modelId: string, llm: TinyLLM): LanguageModelV4 {
  return new TinyLLMLanguageModel(modelId, llm);
}

export interface MappedPrompt {
  messages: Message[];
  warnings: SharedV4Warning[];
}

/** Maps the AI SDK prompt to llm messages. Unsupported parts are skipped with a warning. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch per prompt part type, kept flat
export function mapPrompt(prompt: LanguageModelV4Prompt): MappedPrompt {
  const messages: Message[] = [];
  const warnings: SharedV4Warning[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      messages.push({ content: message.content, role: "system" });
      continue;
    }

    if (message.role === "tool") {
      warnings.push(
        unsupported(
          "tool results",
          "Tool calling is not supported in v1, so tool results were dropped.",
        ),
      );
      continue;
    }

    const texts: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        texts.push(part.text);
      } else if (part.type === "file") {
        warnings.push(
          unsupported(
            "file or image input",
            "Only text is supported in v1, so this part was dropped.",
          ),
        );
      } else if (part.type === "tool-call" || part.type === "tool-result") {
        warnings.push(
          unsupported(
            "tool calls",
            "Tool calling is not supported in v1, so this part was dropped.",
          ),
        );
      } else if (part.type === "reasoning") {
        // Earlier reasoning is not sent back to the model. It is not a user-visible input.
      } else {
        warnings.push(
          unsupported(part.type, "This content type is not supported in v1, so it was dropped."),
        );
      }
    }
    if (texts.length > 0) {
      messages.push({ content: texts.join("\n"), role: message.role });
    }
  }
  return { messages, warnings };
}

export function unsupported(feature: string, details: string): SharedV4Warning {
  return { details, feature, type: "unsupported" };
}

/** Tool definitions are dropped with a warning. A required tool choice cannot be honoured, so it throws. */
function toolWarnings(options: LanguageModelV4CallOptions): SharedV4Warning[] {
  const warnings: SharedV4Warning[] = [];
  if (options.tools && options.tools.length > 0) {
    warnings.push(
      unsupported("tools", "Tool definitions are not supported in v1, so they were ignored."),
    );
  }
  const choice = options.toolChoice;
  if (choice && (choice.type === "required" || choice.type === "tool")) {
    throw new TinyLLMError(
      "INVALID_OPTIONS",
      `toolChoice "${choice.type}" needs tool calling, which v1 does not have`,
      {
        hint: "Remove toolChoice, or use toolChoice: auto or none. Tool calling lands after v1.",
      },
    );
  }
  return warnings;
}

function finishReasonFor(reason: GenerateResult["finishReason"]): LanguageModelV4FinishReason {
  if (reason === "length") {
    return { raw: "length", unified: "length" };
  }
  if (reason === "abort") {
    return { raw: "abort", unified: "other" };
  }
  return { raw: "stop", unified: "stop" };
}

function usageFor(input: number, output: number): LanguageModelV4Usage {
  return {
    inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: input, total: input },
    outputTokens: { reasoning: undefined, text: output, total: output },
  };
}

interface SharedCall {
  maxTokens: number | undefined;
  messages: Message[];
  seed: number | undefined;
  signal: AbortSignal | undefined;
  stop: string[] | undefined;
  temperature: number | undefined;
  topK: number | undefined;
  topP: number | undefined;
}

function sharedCall(options: LanguageModelV4CallOptions, messages: Message[]): SharedCall {
  return {
    maxTokens: options.maxOutputTokens,
    messages,
    seed: options.seed,
    signal: options.abortSignal,
    stop: options.stopSequences,
    temperature: options.temperature,
    topK: options.topK,
    topP: options.topP,
  };
}

/** Builds the core options object, leaving out undefined fields (exactOptionalPropertyTypes). */
function toGenerateOptions(call: SharedCall): Parameters<TinyLLM["generate"]>[0] {
  return {
    messages: call.messages,
    ...(call.maxTokens === undefined ? {} : { maxTokens: call.maxTokens }),
    ...(call.temperature === undefined ? {} : { temperature: call.temperature }),
    ...(call.topP === undefined ? {} : { topP: call.topP }),
    ...(call.topK === undefined ? {} : { topK: call.topK }),
    ...(call.seed === undefined ? {} : { seed: call.seed }),
    ...(call.stop === undefined ? {} : { stop: call.stop }),
    ...(call.signal ? { signal: call.signal } : {}),
  };
}

/**
 * JSON response format with a schema uses the same grammar path as `ai.object()`, so the output
 * is guaranteed to match the schema. Without a schema there is no grammar, so the model is asked
 * for JSON in the prompt and a warning says so.
 */
function jsonPlan(
  options: LanguageModelV4CallOptions,
  messages: Message[],
): {
  messages: Message[];
  schema: Record<string, unknown> | undefined;
  schemaName: string | undefined;
  warnings: SharedV4Warning[];
} {
  const format = options.responseFormat;
  if (format?.type !== "json") {
    return { messages, schema: undefined, schemaName: undefined, warnings: [] };
  }

  if (format.schema) {
    return {
      messages,
      schema: format.schema as Record<string, unknown>,
      schemaName: format.name,
      warnings: [],
    };
  }
  return {
    messages: [
      { content: "Reply with a single valid JSON value and nothing else.", role: "system" },
      ...messages,
    ],
    schema: undefined,
    schemaName: undefined,
    warnings: [
      unsupported(
        "responseFormat without schema",
        "JSON output is only guaranteed with a schema. Add one for grammar-constrained output.",
      ),
    ],
  };
}

class TinyLLMLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "tiny-llm";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  private readonly llm: TinyLLM;

  constructor(modelId: string, llm: TinyLLM) {
    this.modelId = modelId;
    this.llm = llm;
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const mapped = mapPrompt(options.prompt);
    const warnings = [...mapped.warnings, ...toolWarnings(options)];
    const plan = jsonPlan(options, mapped.messages);
    warnings.push(...plan.warnings);

    if (plan.schema) {
      const r = await this.llm.object({
        ...toGenerateOptions(sharedCall(options, plan.messages)),
        schema: plan.schema,
        ...(plan.schemaName ? { schemaName: plan.schemaName } : {}),
      });
      return {
        content: [{ text: r.raw, type: "text" }],
        finishReason: finishReasonFor(r.finishReason),
        usage: usageFor(r.usage.inputTokens, r.usage.outputTokens),
        warnings,
      };
    }

    const r = await this.llm.generate(toGenerateOptions(sharedCall(options, plan.messages)));
    return {
      content: [{ text: r.text, type: "text" }],
      finishReason: finishReasonFor(r.finishReason),
      usage: usageFor(r.usage.inputTokens, r.usage.outputTokens),
      warnings,
    };
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const mapped = mapPrompt(options.prompt);
    const warnings = [...mapped.warnings, ...toolWarnings(options)];
    const plan = jsonPlan(options, mapped.messages);
    warnings.push(...plan.warnings);

    const id = "text-0";
    const { llm } = this;
    const call = toGenerateOptions(sharedCall(options, plan.messages));

    let abort: (() => void) | undefined;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      cancel: () => {
        abort?.();
      },
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings });
        controller.enqueue({ id, type: "text-start" });

        const finish = (usage: LanguageModelV4Usage, reason: LanguageModelV4FinishReason) => {
          controller.enqueue({ id, type: "text-end" });
          controller.enqueue({ finishReason: reason, type: "finish", usage });
          controller.close();
        };

        (async () => {
          try {
            if (plan.schema) {
              // Structured output is not streamed token by token. The whole object arrives as one delta.
              const r = await llm.object({
                ...call,
                schema: plan.schema,
                ...(plan.schemaName ? { schemaName: plan.schemaName } : {}),
              });
              controller.enqueue({ delta: r.raw, id, type: "text-delta" });
              finish(
                usageFor(r.usage.inputTokens, r.usage.outputTokens),
                finishReasonFor(r.finishReason),
              );
              return;
            }

            const s = llm.stream(call);
            abort = () => s.abort();
            for await (const delta of s.textStream) {
              controller.enqueue({ delta, id, type: "text-delta" });
            }
            const r = await s.result;
            finish(
              usageFor(r.usage.inputTokens, r.usage.outputTokens),
              finishReasonFor(r.finishReason),
            );
          } catch (err) {
            controller.enqueue({ error: err, type: "error" });
            controller.close();
          }
        })();
      },
    });

    return { stream };
  }
}
