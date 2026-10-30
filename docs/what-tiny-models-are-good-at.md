# What tiny models are good at

The default model has 0.5 billion parameters. It is small, fast, and runs on a laptop. It does some jobs well, and it fails at others. Pick the job first, then the model.

## Good at

- **Classification** into a fixed set of labels, such as sentiment, intent or topic. Use an enum in your schema.
- **Extraction** of simple fields from short text: names, dates, amounts, addresses. Use a schema with clear field names.
- **Rewriting** a sentence in a different tone, or shortening it.
- **Tagging** text with keywords from a list you supply.
- **Short copy**: a product blurb, a subject line, a one-line summary of a paragraph.

Example prompts that work well:

```text
Classify the sentiment and confidence of this review: "The battery died after one day."
Extract the name, age and city from: "Alex, 34, lives in Lisbon."
Rewrite this in a friendly tone, keeping it under 20 words: "Your order has shipped."
```

## Weak at

- **Facts**. A 0.5B model confidently invents details. Do not use it as a source of truth. Give it the facts in the prompt and ask it to use them.
- **Reasoning**. Multi-step arithmetic, logic puzzles and planning are unreliable.
- **Long-form writing**. It loses the thread after a few paragraphs.
- **Tool use**. Not supported in v1, and small models are poor at it anyway.
- **Languages other than English** at the quality you would expect from a large model.

## Structured output is reliable, content is not

The grammar guarantees the JSON has the right shape, so `object()` never gives you broken output. It does not guarantee the values are right. A classification can be fluent and wrong. Build checks for the values that matter, or use the bigger model for them.

## When to use the bigger model

Use `qwen2.5-1.5b` when classification or extraction accuracy matters more than speed, and you have the memory (about 3 times the default). Use a hosted model when you need reasoning, long documents or world knowledge.
