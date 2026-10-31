---
name: ggml-node-testing
description: Test code that calls ggml-node without a model, using ggml-node/testing. Covers mock replies, streaming, object(), and the AI SDK mock model. Use it in unit tests.
---

# ggml-node-testing

Unit tests must not load a model or touch the network. `ggml-node/testing` gives you the same API with a deterministic backend, and it loads no native code.

```ts
import { createMockGgmlNode, mockModel } from "ggml-node/testing";
import { generateText } from "ai";

const ai = createMockGgmlNode({ respond: "a fixed answer" });
expect((await ai.generate({ prompt: "anything" })).text).toBe("a fixed answer");

expect((await generateText({ model: mockModel({ respond: "hi" }), prompt: "x" })).text).toBe("hi");
```

## Rules

- `respond` can be a string, an ordered list (cycles when it runs out), or a function of the request messages.
- For streaming tests, use `tokensPerChunk` to control chunk size, and `delayMs` to test aborts mid-stream.
- For `object()`, make `respond` return JSON text. The schema is checked, so a wrong shape fails the test.
- Do not mock ggml-node's internals. Mock at `createMockGgmlNode` or `mockModel`, so the code under test sees the real API.
- Real-model tests belong in a separate suite, gated behind an environment variable, not in unit tests.
