# Express server example

An Express endpoint that serves one shared model. local-llm is a library, not a server: the HTTP layer here is yours.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@local-llm/example-express-server' start
```

Then:

```sh
curl -s localhost:3000/generate -H 'content-type: application/json' -d '{"prompt":"Hi"}'
```

## Notes

- Listens on `PORT` (default `3000`).
- A full queue returns `503`; other errors return `500`.
- `GET /health` reports the loaded model id.
