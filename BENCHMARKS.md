# Benchmarks

These numbers are measured on one machine. Each table says how it was taken, so you can judge how far it applies to yours.

## Test machine

| | |
| --- | --- |
| Model | MacBookPro18,2 (2021) |
| Chip | Apple M1 Max, 10 cores (8 performance, 2 efficiency), 32-core GPU, Metal 4 |
| Memory | 32 GB unified, 12 GB swap configured |
| OS | macOS 26.6.2 (build 25G83), Darwin 25.6.0 |
| Node | 22.23.3 |
| Backend | `metal` (node-llama-cpp 3.22.2) |

**Conditions during the runs.** The machine was not idle. Load average was 20 to 22 (1-minute) and 45 to 47 (15-minute), with 81% user CPU from other applications (a virtual machine, several AI coding tools, a browser). Free memory was 46% to 59%, and swap was 10.7 GB of 12 GB used. The runs were done together, in one session, on the same machine.

These are working-day numbers, not peak numbers. A quiet machine will be faster, especially for load time and first token. See [not yet measured](#not-yet-measured).

## How to measure

Generation models, with the built-in command:

```sh
npx ggml-node bench qwen2.5-0.5b --tokens 128          # table
npx ggml-node bench qwen2.5-0.5b --tokens 128 --json   # for scripts
```

The command loads the model, generates `--tokens` tokens from a fixed prompt at `temperature: 0`, and reports:

- `loadMs`: time for `ready()`, including reading the file and creating the context
- `firstTokenMs`: time from the start of generation to the first token
- `tokensPerSecond`: generated tokens divided by generation time
- `peakRssBytes`: the highest resident memory sampled during the run (every 50 ms)

Embedding models, with the script in this repo (run `bun run build` first):

```sh
node scripts/bench-embedding.mjs bge-small-en-v1.5 --batch 64 --runs 5
```

It reports load time, the median latency of a single text (10 calls), the median time and texts per second for a batch of 64 distinct sentences (5 runs), and peak RSS. The batch is 64 separate inputs, so `textsPerSecond` counts texts, not calls.

**Method used for the results below.** Each row is the median of three separate processes. Each process is one fresh load and one run. The median is what the tables show, and the individual runs are listed under each table.

## Generation models

Output: 128 tokens, `temperature: 0`, one sequence, `contextSize` default. Q4_K_M for Qwen, Q8_0 for SmolLM2.

| Model | Size on disk | Load | First token | Tokens/s | Peak RSS |
| --- | --- | --- | --- | --- | --- |
| `qwen2.5-0.5b` | 491 MB | 3.1 s | 178 ms | 91.1 | 1036 MB |
| `qwen2.5-1.5b` | 1.12 GB | 3.5 s | 317 ms | 75.0 | 1700 MB |
| `smollm2-360m` | 386 MB | 1.9 s | 423 ms | 90.1 | 871 MB |

Individual runs (load, first token, tokens/s, peak RSS):

- `qwen2.5-0.5b`: 3.5 s, 494 ms, 85.5, 888 MB · 3.1 s, 178 ms, 91.1, 1036 MB · 2.6 s, 80 ms, 148.2, 1038 MB
- `qwen2.5-1.5b`: 2.8 s, 330 ms, 87.5, 1711 MB · 3.5 s, 297 ms, 75.0, 1697 MB · 3.5 s, 317 ms, 54.7, 1701 MB
- `smollm2-360m`: 2.3 s, 494 ms, 90.1, 871 MB · 1.9 s, 423 ms, 70.1, 862 MB · 1.8 s, 86 ms, 126.4, 880 MB

The spread between runs is large. The third `qwen2.5-0.5b` run was far faster than the others, under the same conditions, so treat these as a range. The machine was busy, and that is the likely cause.

## Embedding models

Output: 384 dimensions for `bge-small-en-v1.5` (Q8_0, 512-token context).

| Model | Size on disk | Load | Single text | Batch of 64 (texts/s) | Peak RSS |
| --- | --- | --- | --- | --- | --- |
| `bge-small-en-v1.5` | 37 MB | 1.2 s | 9.3 ms | 96.3 | 328 MB |

Individual runs (load, single-text median, batch texts/s, peak RSS):

- 1.2 s, 9.3 ms, 96.3, 330 MB
- 1.1 s, 7.3 ms, 106.3, 328 MB
- 1.2 s, 10.3 ms, 96.0, 324 MB

Embedding a batch takes about 0.6 s, for 64 separate inputs.

## Not yet measured

- A quiet-machine run on Apple silicon: nothing else open, idle for a few minutes first. Repeat both commands and record the same fields.
- A 4-vCPU x64 Linux machine, CPU only. Run `npx ggml-node bench` there, and add the result.
- Structured output (`object`) and streaming throughput. Both use the same generation path, so they are not expected to differ much, but they are not measured here.

When you add a row, record the machine, the OS, the Node version, the backend, the model, `--tokens` (or the batch size for embeddings), and whether anything else was competing for CPU and memory.
