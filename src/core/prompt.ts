import { InboardError } from "./errors.js";
import type { GenerateOptions, Message } from "./types.js";

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
  const hasPrompt = options.prompt !== undefined;
  const hasMessages = options.messages !== undefined;
  if (hasPrompt === hasMessages) {
    throw invalid(
      "Pass exactly one of prompt or messages",
      "Use prompt for a single user turn, or messages for a chat.",
    );
  }

  const conversation: Message[] = hasPrompt
    ? [{ role: "user", content: options.prompt as string }]
    : [...(options.messages as Message[])];

  if (conversation.length === 0) {
    throw invalid("messages must not be empty", "Pass at least one message.");
  }
  for (const m of conversation) {
    if (typeof m.content !== "string") {
      throw invalid(
        `message content must be a string (role ${m.role})`,
        "Only text content is supported in v1.",
      );
    }
  }

  if (options.system !== undefined) {
    if (conversation[0]?.role === "system") {
      throw invalid(
        "Both system and a leading system message were given",
        "Pass the system text once.",
      );
    }
    conversation.unshift({ role: "system", content: options.system });
  }

  const maxTokens = integerOption(options.maxTokens, DEFAULT_MAX_TOKENS, "maxTokens", 1);
  const temperature = numberOption(options.temperature, DEFAULT_TEMPERATURE, "temperature", 0, 2);
  const topP = optionalNumber(options.topP, "topP", 0, 1, { exclusiveMin: true });
  const topK = optionalInteger(options.topK, "topK", 0);
  const seed = optionalInteger(options.seed, "seed", 0);
  const stop = options.stop;
  if (stop?.some((s) => typeof s !== "string" || s.length === 0)) {
    throw invalid("stop must be an array of non-empty strings", "Remove empty stop sequences.");
  }

  return {
    messages: conversation,
    maxTokens,
    temperature,
    topP,
    topK,
    seed,
    stop,
    overflow: options.overflow ?? "error",
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

function integerOption(
  value: number | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min) {
    throw invalid(
      `${name} must be an integer >= ${min}`,
      `Set ${name} to a whole number of at least ${min}.`,
    );
  }
  return value;
}

function numberOption(
  value: number | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw invalid(
      `${name} must be between ${min} and ${max}`,
      `Set ${name} inside [${min}, ${max}].`,
    );
  }
  return value;
}

function optionalNumber(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
  opts: { exclusiveMin?: boolean } = {},
): number | undefined {
  if (value === undefined) return undefined;
  const belowMin = opts.exclusiveMin ? value <= min : value < min;
  if (!Number.isFinite(value) || belowMin || value > max) {
    throw invalid(`${name} is out of range`, `Set ${name} inside the documented range.`);
  }
  return value;
}

function optionalInteger(value: number | undefined, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) {
    throw invalid(`${name} must be an integer >= ${min}`, `Set ${name} to a whole number.`);
  }
  return value;
}
