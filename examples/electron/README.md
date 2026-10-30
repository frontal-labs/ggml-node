# Electron example

A skeleton for an Electron app that runs the model in its main process, with process isolation. It is **not run** in this repository, because it needs a desktop session and Electron itself. Treat it as a starting point and test it on your machine.

1. Copy `qwen2.5-0.5b-instruct-q4_k_m.gguf` into `models/` (use `npx inboard pull qwen2.5-0.5b --dir models`).
2. Install Electron and electron-builder in your app.
3. Use `electron-builder.json` so the native binaries are unpacked from the asar archive and the model is copied into the resources.

See [deployment](../../docs/deployment.md#electron) for the details.
