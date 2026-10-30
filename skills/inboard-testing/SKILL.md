---
name: inboard-testing
description: Test code that calls inboard-sdk without a model, using inboard-sdk/testing. Covers mock replies, streaming, object(), and the AI SDK mock model. Use it in unit tests.
---

# inboard-testing

Unit tests must not load a model or touch the network. `inboard-sdk/testing` gives you the same API with a deterministic backend, and it loads no native code.

```ts
import { createMockInboard, mockModel } from "inboard-sdk/testing";
import { generateText } from "ai";

const ai = createMockInboard({ respond: "a fixed answer" });
expect((await ai.generate({ prompt: "anything" })).text).toBe("a fixed answer");

expect((await generateText({ model: mockModel({ respond: "hi" }), prompt: "x" })).text).toBe("hi");
```

## Rules

- `respond` can be a string, an ordered list (cycles when it runs out), or a function of the request messages.
- For streaming tests, use `tokensPerChunk` to control chunk size, and `delayMs` to test aborts mid-stream.
- For `object()`, make `respond` return JSON text. The schema is checked, so a wrong shape fails the test.
- Do not mock inboard's internals. Mock at `createMockInboard` or `mockModel`, so the code under test sees the real API.
- Real-model tests belong in a separate suite, gated behind an environment variable, not in unit tests.
