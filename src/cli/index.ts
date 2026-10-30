import { runCli } from "./run.js";

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  stderrIsTTY: process.stderr.isTTY,
});
process.exitCode = code;
