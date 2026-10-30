import { runWorker } from "@/backend/isolated/worker.js";
import { createFakeBackend } from "./fake-backend.js";

/**
 * A worker entry for tests. It runs the real worker protocol with a fake backend. A prompt that
 * contains CRASH kills the process mid-generation, so the crash path runs for real.
 */
runWorker(() => {
  const inner = createFakeBackend({
    delayMs: 4,
    respond: (messages) => {
      const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      return last.startsWith("classify") ? '{"label":"ok"}' : `echo: ${last}`;
    },
  });
  return {
    ...inner,
    generate: (sequence, request, onDelta) => {
      if (request.messages.some((m) => m.content.includes("CRASH"))) {
        process.exit(1);
      }
      return inner.generate(sequence, request, onDelta);
    },
  };
});
