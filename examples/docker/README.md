# Docker example

Builds a container with the default model baked into its own layer.

```sh
bun run build                       # from the repo root, so the local package is built
docker build -t inboard-example -f examples/docker/Dockerfile .
docker run --rm -p 3000:3000 inboard-example
curl -s localhost:3000/generate -d '{"prompt":"Say hi."}'
```

Notes:

- `INBOARD_OFFLINE=1` makes the container refuse to download at runtime.
- The Dockerfile installs the published `inboard-sdk` from npm. To test a local build, replace that line with a copy of the repo's `dist/` and `package.json`.
- This example has not been built in this repository. Run `docker build` on your machine before you rely on it.
