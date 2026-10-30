import { runCli } from "@/cli/run.js";

const code = await runCli(process.argv.slice(2), {
  stderr: (text) => {
    process.stderr.write(text);
  },
  stderrIsTTY: process.stderr.isTTY,
  stdout: (text) => {
    process.stdout.write(text);
  },
});
process.exitCode = code;
