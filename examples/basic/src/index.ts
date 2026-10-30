/**
 * The core API: generate, stream, and unload. Run from the repo root:
 *   bun run build && bun --filter '@tiny-llm/example-basic' start
 */
import { createTinyLLM } from "tiny-llm";

const ai = createTinyLLM({ model: "qwen2.5-0.5b" });

const info = await ai.ready();
console.log(
  `loaded ${info.id} on ${info.gpu === false ? "cpu" : info.gpu} (context ${info.contextSize})`,
);

const answer = await ai.generate({
  maxTokens: 64,
  prompt: "In one sentence, what is a river?",
  temperature: 0,
});
console.log("generate:", answer.text.trim());
console.log("  usage:", answer.usage, "finish:", answer.finishReason);

process.stdout.write("stream: ");
const s = ai.stream({ maxTokens: 48, prompt: "Name three rivers.", temperature: 0 });
for await (const delta of s.textStream) {
  process.stdout.write(delta);
}
process.stdout.write("\n");
console.log("  result matches stream:", (await s.result).text.length > 0);

await ai.unload();
console.log("unloaded:", ai.info() === null);
