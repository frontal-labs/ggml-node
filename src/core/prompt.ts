import { InboardError } from "@/core/errors.js";
import { firstIssue, generateOptionsSchema } from "@/core/schemas.js";
import type { GenerateOptions, Message } from "@/core/types.js";

export type OverflowPolicy = NonNullable<GenerateOptions["overflow"]>;

export interface NormalizedRequest {
  messages: Message[];
  maxTokens: number;
  temperature: number;
  topP: number | undefined;
  topK: number | undefined;
  seed: number | undefined;
  stop: string[] | undefined;
  overflow: OverflowPolicy;
}

export const DEFAULT_MAX_TOKENS = 256;
export const DEFAULT_TEMPERATURE = 0.7;

/**
 * Turns `prompt | messages | system` into one validated message list.
 * Throws `INVALID_OPTIONS` for any input the contract does not allow.
 */
export function normalizeRequest(options: GenerateOptions): NormalizedRequest {
  const parsed = generateOptionsSchema.safeParse(options);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    throw invalid(
      `${issue.path}: ${issue.message}`,
      "Check the generate options against the documented ranges.",
    );
  }
  const o = parsed.data;

  const hasPrompt = o.prompt !== undefined;
  const hasMessages = o.messages !== undefined;
  if (hasPrompt === hasMessages) {
    throw invalid(
      "Pass exactly one of prompt or messages",
      "Use prompt for a single user turn, or messages for a chat.",
    );
  }

  const conversation: Message[] = hasPrompt
    ? [{ role: "user", content: o.prompt as string }]
    : [...(o.messages ?? [])];

  if (conversation.length === 0) {
    throw invalid("messages must not be empty", "Pass at least one message.");
  }

  if (o.system !== undefined) {
    if (conversation[0]?.role === "system") {
      throw invalid(
        "Both system and a leading system message were given",
        "Pass the system text once.",
      );
    }
    conversation.unshift({ role: "system", content: o.system });
  }

  return {
    messages: conversation,
    maxTokens: o.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: o.temperature ?? DEFAULT_TEMPERATURE,
    topP: o.topP,
    topK: o.topK,
    seed: o.seed,
    stop: o.stop,
    overflow: o.overflow ?? "error",
  };
}

/**
 * Applies the overflow policy until the prompt fits in `budget` tokens. The system message and
 * the last user message are never removed.
 *
 * - `error`: throw `CONTEXT_OVERFLOW` unless it already fits.
 * - `truncate-start`: drop the oldest removable messages first.
 * - `truncate-middle`: drop the messages nearest the middle first, keeping the start of the
 *   conversation and the most recent turns.
 */
export async function fitToBudget(
  messages: Message[],
  budget: number,
  policy: OverflowPolicy,
  countTokens: (messages: Message[]) => Promise<number>,
): Promise<Message[]> {
  let current = [...messages];
  let tokens = await countTokens(current);
  if (tokens <= budget) return current;

  if (policy === "error") {
    throw overflow(tokens, budget);
  }

  while (tokens > budget) {
    const index = nextRemovable(current, policy);
    if (index === undefined) throw overflow(tokens, budget);
    current = current.filter((_, i) => i !== index);
    tokens = await countTokens(current);
  }
  return current;
}

/** Index of the next message to drop, or `undefined` when nothing else can go. */
function nextRemovable(messages: Message[], policy: OverflowPolicy): number | undefined {
  const lastUser = findLastIndex(messages, (m) => m.role === "user");
  const candidates: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "system" || i === lastUser) return;
    candidates.push(i);
  });
  if (candidates.length === 0) return undefined;

  if (policy === "truncate-start") return candidates[0];

  // truncate-middle: keep the first removable message and drop the one closest to the middle.
  const interior = candidates.slice(1);
  if (interior.length === 0) return undefined;
  return interior[Math.floor(interior.length / 2)];
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

function overflow(tokens: number, budget: number): InboardError {
  return new InboardError(
    "CONTEXT_OVERFLOW",
    `Prompt is ${tokens} tokens, but only ${budget} fit in the context`,
    {
      hint: "Shorten the input, lower maxTokens, raise contextSize, or set overflow to truncate-start or truncate-middle.",
    },
  );
}

function invalid(message: string, hint: string): InboardError {
  return new InboardError("INVALID_OPTIONS", message, { hint });
}
