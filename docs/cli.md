# CLI

Install the package, then run `npx tiny-llm`, or `bunx tiny-llm` in a Bun project.

```text
tiny-llm pull <modelId> [--dir <path>]     download and verify a model
tiny-llm list [--json]                     models, cache state, size and license
tiny-llm run <prompt> [--model <id>] [--json-schema <file>] [--json]
tiny-llm bench [modelId] [--tokens <n>] [--json]
tiny-llm doctor [--json]                   platform, memory, cache, and a backend check
tiny-llm cache path                        print the cache directory
tiny-llm cache clear [<modelId>]           delete cached files for one model or all
tiny-llm --version
tiny-llm --help
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. Also `doctor` with only warnings. |
| `1` | Usage error: an unknown command, option or model id, or a bad flag value. |
| `2` | Environment error: network, disk, checksum, or a failed `doctor` check. |

## `pull`

Downloads a registry model into the cache, or into `--dir`. If the file is already there, it is verified and reported. A file that fails its checksum is downloaded again. Pull needs the network, so it refuses to run when offline mode is on.

## `list`

A table of the registry: id, size, license, whether it is cached, and the cache directory. `--json` prints the same rows as JSON.

## `run`

Generates one response. `--json-schema <file>` reads a JSON Schema file and prints a validated object. `--json` prints the result with usage and timing.

```sh
npx tiny-llm run "What is a river?"
npx tiny-llm run "Extract: Alex, 34, Lisbon" --json-schema person.schema.json
```

## `bench`

Measures a model on this machine: load time, time to first token, tokens per second, peak resident memory, and the backend (`metal`, `cuda`, `vulkan` or `false`). Use `--tokens` to set the output length. The table is for people; `--json` is for scripts.

## `doctor`

Checks what tiny-llm needs, and says how to fix each problem:

- platform, CPU and Node version
- available memory, and any container limit
- the cache directory is writable
- the default model is cached
- the backend loads and generates a few tokens

A failed check exits with code 2 and prints a `fix:` line under it.

## `cache`

`cache path` prints the directory. `cache clear` deletes the registry files and their `.partial` and `.lock` leftovers. It only touches registry file names.
