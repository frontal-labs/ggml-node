---
name: tiny-llm-testing
description: Test code that calls tiny-llm without a model, using tiny-llm/testing. Covers mock replies, streaming, object(), and the AI SDK mock model. Use it in unit tests.
---

# tiny-llm-testing

Unit tests must not load a model or touch the network. `tiny-llm/testing` gives you the same API with a deterministic backend, and it loads no native code.

```ts
import { createMockTinyLLM, mockModel } from "tiny-llm/testing";
import { generateText } from "ai";

const ai = createMockTinyLLM({ respond: "a fixed answer" });
expect((await ai.generate({ prompt: "anything" })).text).toBe("a fixed answer");

expect((await generateText({ model: mockModel({ respond: "hi" }), prompt: "x" })).text).toBe("hi");
```

## Rules

- `respond` can be a string, an ordered list (cycles when it runs out), or a function of the request messages.
- For streaming tests, use `tokensPerChunk` to control chunk size, and `delayMs` to test aborts mid-stream.
- For `object()`, make `respond` return JSON text. The schema is checked, so a wrong shape fails the test.
- Do not mock tiny-llm's internals. Mock at `createMockTinyLLM` or `mockModel`, so the code under test sees the real API.
- Real-model tests belong in a separate suite, gated behind an environment variable, not in unit tests.
