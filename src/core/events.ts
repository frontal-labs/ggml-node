import type { TinyLLMEvent } from "@/core/types.js";

export type TinyLLMEventListener = (event: TinyLLMEvent) => void;

/**
 * Delivers an event to the user's `onEvent` hook. Events are local only: nothing is sent anywhere.
 * A listener that throws is isolated, so a logging hook cannot break inference.
 */
export function emitEvent(listener: TinyLLMEventListener | undefined, event: TinyLLMEvent): void {
  if (!listener) {
    return;
  }
  try {
    listener(event);
  } catch {
    // Intentionally ignored. See the comment above.
  }
}
