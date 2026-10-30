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
import { InboardError } from "../core/errors.js";
import type { GenerateResult, Inboard, Message, ModelId } from "../core/types.js";

/**
 * Internal: the `LanguageModelV4` implementation. `src/ai/index.ts` exposes the public API.
 * Tests build models directly from a fake-backed Inboard through `languageModelFor`.
 */
export function languageModelFor(modelId: ModelId, inboard: Inboard): LanguageModelV4 {
  return new InboardLanguageModel(modelId, inboard);
}

export interface MappedPrompt {
  messages: Message[];
  warnings: SharedV4Warning[];
}

/** Maps the AI SDK prompt to inboard messages. Unsupported parts are skipped with a warning. */
export function mapPrompt(prompt: LanguageModelV4Prompt): MappedPrompt {
  const messages: Message[] = [];
  const warnings: SharedV4Warning[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      messages.push({ role: "system", content: message.content });
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
      messages.push({ role: message.role, content: texts.join("\n") });
    }
  }
  return { messages, warnings };
}

export function unsupported(feature: string, details: string): SharedV4Warning {
  return { type: "unsupported", feature, details };
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
    throw new InboardError(
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
  if (reason === "length") return { unified: "length", raw: "length" };
  if (reason === "abort") return { unified: "other", raw: "abort" };
  return { unified: "stop", raw: "stop" };
}

function usageFor(input: number, output: number): LanguageModelV4Usage {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

interface SharedCall {
  messages: Message[];
  maxTokens: number | undefined;
  temperature: number | undefined;
  topP: number | undefined;
  topK: number | undefined;
  seed: number | undefined;
  stop: string[] | undefined;
  signal: AbortSignal | undefined;
}

function sharedCall(options: LanguageModelV4CallOptions, messages: Message[]): SharedCall {
  return {
    messages,
    maxTokens: options.maxOutputTokens,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    seed: options.seed,
    stop: options.stopSequences,
    signal: options.abortSignal,
  };
}

/** Builds the core options object, leaving out undefined fields (exactOptionalPropertyTypes). */
function toGenerateOptions(call: SharedCall): Parameters<Inboard["generate"]>[0] {
  return {
    messages: call.messages,
    ...(call.maxTokens !== undefined ? { maxTokens: call.maxTokens } : {}),
    ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
    ...(call.topP !== undefined ? { topP: call.topP } : {}),
    ...(call.topK !== undefined ? { topK: call.topK } : {}),
    ...(call.seed !== undefined ? { seed: call.seed } : {}),
    ...(call.stop !== undefined ? { stop: call.stop } : {}),
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
  if (format?.type !== "json")
    return { messages, schema: undefined, schemaName: undefined, warnings: [] };

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
      { role: "system", content: "Reply with a single valid JSON value and nothing else." },
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

class InboardLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "inboard";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  private readonly inboard: Inboard;

  constructor(modelId: ModelId, inboard: Inboard) {
    this.modelId = modelId;
    this.inboard = inboard;
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const mapped = mapPrompt(options.prompt);
    const warnings = [...mapped.warnings, ...toolWarnings(options)];
    const plan = jsonPlan(options, mapped.messages);
    warnings.push(...plan.warnings);

    if (plan.schema) {
      const r = await this.inboard.object({
        ...toGenerateOptions(sharedCall(options, plan.messages)),
        schema: plan.schema,
        ...(plan.schemaName ? { schemaName: plan.schemaName } : {}),
      });
      return {
        content: [{ type: "text", text: r.raw }],
        finishReason: finishReasonFor(r.finishReason),
        usage: usageFor(r.usage.inputTokens, r.usage.outputTokens),
        warnings,
      };
    }

    const r = await this.inboard.generate(toGenerateOptions(sharedCall(options, plan.messages)));
    return {
      content: [{ type: "text", text: r.text }],
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
    const inboard = this.inboard;
    const call = toGenerateOptions(sharedCall(options, plan.messages));

    let abort: (() => void) | undefined;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings });
        controller.enqueue({ type: "text-start", id });

        const finish = (usage: LanguageModelV4Usage, reason: LanguageModelV4FinishReason) => {
          controller.enqueue({ type: "text-end", id });
          controller.enqueue({ type: "finish", usage, finishReason: reason });
          controller.close();
        };

        void (async () => {
          try {
            if (plan.schema) {
              // Structured output is not streamed token by token. The whole object arrives as one delta.
              const r = await inboard.object({
                ...call,
                schema: plan.schema,
                ...(plan.schemaName ? { schemaName: plan.schemaName } : {}),
              });
              controller.enqueue({ type: "text-delta", id, delta: r.raw });
              finish(
                usageFor(r.usage.inputTokens, r.usage.outputTokens),
                finishReasonFor(r.finishReason),
              );
              return;
            }

            const s = inboard.stream(call);
            abort = () => s.abort();
            for await (const delta of s.textStream) {
              controller.enqueue({ type: "text-delta", id, delta });
            }
            const r = await s.result;
            finish(
              usageFor(r.usage.inputTokens, r.usage.outputTokens),
              finishReasonFor(r.finishReason),
            );
          } catch (err) {
            controller.enqueue({ type: "error", error: err });
            controller.close();
          }
        })();
      },
      cancel: () => {
        abort?.();
      },
    });

    return { stream };
  }
}
