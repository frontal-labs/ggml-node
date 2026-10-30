import type { LocalLLMEvent } from "@/core/types.js";

export type LocalLLMEventListener = (event: LocalLLMEvent) => void;

/**
 * Delivers an event to the user's `onEvent` hook. Events are local only: nothing is sent anywhere.
 * A listener that throws is isolated, so a logging hook cannot break inference.
 */
export function emitEvent(listener: LocalLLMEventListener | undefined, event: LocalLLMEvent): void {
  if (!listener) {
    return;
  }
  try {
    listener(event);
  } catch {
    // Intentionally ignored. See the comment above.
  }
}
