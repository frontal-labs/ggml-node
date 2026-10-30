// Electron main process. The model ships in resources/, and the native binaries are unpacked from
// the asar archive (see electron-builder.json). Not run in this repository.

import path from "node:path";
// biome-ignore lint/correctness/noUndeclaredDependencies: electron is installed by the Electron app that uses this skeleton
import { app, BrowserWindow, ipcMain } from "electron";
import { createTinyLLM } from "tiny-llm";

const modelPath = app.isPackaged
  ? path.join(process.resourcesPath, "models", "qwen2.5-0.5b-instruct-q4_k_m.gguf")
  : path.join(app.getAppPath(), "models", "qwen2.5-0.5b-instruct-q4_k_m.gguf");

// Process isolation keeps a native crash from taking the main process down.
const ai = createTinyLLM({ isolation: "process", model: { path: modelPath } });

ipcMain.handle("tiny-llm:generate", async (_event, prompt) => {
  const result = await ai.generate({ maxTokens: 96, prompt: String(prompt) });
  return result.text;
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ height: 600, width: 800 });
  win.loadURL("data:text/html,<h1>tiny-llm example</h1>");
});
