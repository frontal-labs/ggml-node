# Docker example

A container that serves the default model over HTTP. The model is baked into its own image layer.

## Build and run

From the repository root:

```sh
bun run build
bun pm pack                               # writes inboard-sdk-<version>.tgz
docker build -f examples/docker/Dockerfile -t inboard-example .
docker run --rm -p 3000:3000 inboard-example
curl -s localhost:3000/generate -H 'content-type: application/json' -d '{"prompt":"Say hi."}'
```

The image installs the packed tarball, so it builds before `inboard-sdk` is on npm. Once it is published, replace the two `COPY inboard-sdk-*.tgz` / `npm install` steps with `npm install inboard-sdk`.

## Notes

- `INBOARD_OFFLINE=1` makes the running container refuse to download. The model must already be in the image, which the `model` stage guarantees.
- The `model` stage needs network access during `docker build`, to download the 491 MB model.
- This example has not been built in this repository. The Docker daemon was not running when it was prepared. Build it on your machine before you rely on it.
