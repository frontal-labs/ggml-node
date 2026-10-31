# Benchmarks

These numbers are measured. Each one says how it was taken, so you can judge how far it applies to your machine.

## How to measure

```sh
npx ggml-node bench qwen2.5-0.5b --tokens 128          # table
npx ggml-node bench qwen2.5-0.5b --tokens 128 --json   # for scripts
```

The benchmark loads the model, generates `--tokens` tokens from a fixed prompt at `temperature: 0`, and reports:

- `loadMs`: time for `ready()`, including reading the file and creating the context
- `firstTokenMs`: time from the start of generation to the first token
- `tokensPerSecond`: generated tokens divided by generation time
- `peakRssBytes`: the highest resident memory sampled during the run (every 50 ms)

## Results

Machine: Apple M1 Max, 32 GB, macOS (Darwin 25.6), Node 22.23. Backend: `metal`. Model: `qwen2.5-0.5b` (Q4_K_M), 128 output tokens.

| Run | Load | First token | Tokens/s | Peak RSS |
| --- | --- | --- | --- | --- |
| 1 | 18.4 s | 1.7 s | 20.0 | 642 MB |
| 2 | 20.3 s | 1.5 s | 21.5 | 690 MB |
| 3 | 15.1 s | 0.9 s | 30.8 | 742 MB |

**Conditions matter.** When these runs were taken, the machine was under heavy memory pressure. Swap was 12.7 GB of 13.3 GB used, with several other large applications open. Load times of 15 to 34 seconds are a symptom of that pressure, and they are not representative of a quiet machine. The first token and generation speed were also lower than an idle machine would give.

A shorter test on this machine, earlier and under less pressure, measured 8.4 tokens/s for a 7-token answer. Short outputs include start-up cost, so they understate steady speed.

## Not yet measured

- A quiet-machine run on Apple silicon. Repeat it with nothing else open, and record the same fields.
- A 4-vCPU x64 Linux machine, CPU only. The plan asks for it. Run `npx ggml-node bench` there, and add the result.
- Models other than the default. `qwen2.5-1.5b` and `smollm2-360m` are in the registry, and neither has been benchmarked here.

When you add a row, record the machine, the OS, the Node version, the backend, the model, `--tokens`, and whether anything else was competing for memory.
