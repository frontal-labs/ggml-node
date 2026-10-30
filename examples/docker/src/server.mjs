// A minimal HTTP server for the container. It needs the model cached in TINY_LLM_CACHE_DIR.
import { createServer } from "node:http";
import { createTinyLLM } from "tiny-llm";

const ai = createTinyLLM({ model: "qwen2.5-0.5b" });

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/generate") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  const { prompt } = JSON.parse(raw || "{}");
  const result = await ai.generate({ maxTokens: 64, prompt: String(prompt ?? "Hello") });
  res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ text: result.text }));
}).listen(Number(process.env.PORT ?? 3000), () =>
  console.log(`listening on :${process.env.PORT ?? 3000}`),
);
