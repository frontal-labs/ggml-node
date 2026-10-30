/**
 * An Express endpoint that serves one shared model. inboard is a library, not a server: the HTTP
 * layer here is yours. Run from the repo root:
 *   bun run build && bun --filter '@inboard/example-express-server' start
 * Then: curl -s localhost:3000/generate -H 'content-type: application/json' -d '{"prompt":"Hi"}'
 */
import express from "express";
import { createInboard, isInboardError } from "inboard-sdk";
import { z } from "zod";

const ai = createInboard({ maxConcurrency: 2, maxQueue: 16, model: "qwen2.5-0.5b" });
const body = z.object({
  maxTokens: z.number().int().min(1).max(256).default(64),
  prompt: z.string().min(1),
});

const app = express();
app.use(express.json());

app.post("/generate", async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    return;
  }
  try {
    const result = await ai.generate({
      maxTokens: parsed.data.maxTokens,
      prompt: parsed.data.prompt,
    });
    res.json({ finishReason: result.finishReason, text: result.text, usage: result.usage });
  } catch (err) {
    // Map inboard's codes to HTTP: a full queue is a 503, everything else is reported as-is.
    const status = isInboardError(err) && err.code === "QUEUE_FULL" ? 503 : 500;
    res.status(status).json({
      code: isInboardError(err) ? err.code : "UNKNOWN",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ model: ai.info()?.id ?? "not loaded" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});
