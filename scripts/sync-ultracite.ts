/**
 * Keeps biome.json in step with ultracite.json.
 *
 *   bun run ultracite:sync    writes biome.json from ultracite.json
 *   bun run ultracite:check   exits 1 when biome.json differs from what ultracite.json produces
 *
 * Ultracite's CLI does not read ultracite.json itself. This script is the link: the Biome config
 * (the engine Ultracite configures) is generated from it, so one file records every choice.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "ultracite.json");
const TARGET = join(ROOT, "biome.json");

const sourceSchema = z.object({
  $comment: z.string().optional(),
  $schema: z.string().optional(),
  agents: z.array(z.enum(["claude", "cursor", "codex"])),
  assist: z.object({ organizeImports: z.boolean() }),
  editors: z.array(z.enum(["vscode", "zed"])),
  exclude: z.array(z.string()),
  formatter: z.object({
    indentStyle: z.enum(["space", "tab"]),
    indentWidth: z.number().int().positive(),
    lineWidth: z.number().int().positive(),
  }),
  frameworks: z.array(z.string()),
  include: z.array(z.string()),
  javascript: z.object({
    quoteStyle: z.enum(["double", "single"]),
    semicolons: z.enum(["always", "asNeeded"]),
    trailingCommas: z.enum(["all", "es5", "none"]),
  }),
  linter: z.literal("biome"),
  preset: z.string().min(1),
  rules: z.object({
    error: z.record(z.string(), z.boolean()),
    preset: z.enum(["recommended", "all"]),
  }),
});

type Source = z.infer<typeof sourceSchema>;

/** The biome.json this source produces. Pure, so the check and the write agree exactly. */
export function biomeConfigFor(source: Source): Record<string, unknown> {
  const rules: Record<string, unknown> = { preset: source.rules.preset };
  for (const [path, enabled] of Object.entries(source.rules.error)) {
    const [group, rule] = path.split("/");
    if (!(group && rule)) {
      throw new Error(`rule "${path}" must look like group/rule`);
    }
    const groupRules = (rules[group] as Record<string, unknown> | undefined) ?? {};
    groupRules[rule] = enabled ? "error" : "off";
    rules[group] = groupRules;
  }
  return {
    $schema: "./node_modules/@biomejs/biome/configuration_schema.json",
    assist: {
      actions: { source: { organizeImports: source.assist.organizeImports ? "on" : "off" } },
    },
    extends: [source.preset],
    files: {
      includes: [...source.include, ...source.exclude.map((glob) => `!${glob}`)],
    },
    formatter: {
      enabled: true,
      indentStyle: source.formatter.indentStyle,
      indentWidth: source.formatter.indentWidth,
      lineWidth: source.formatter.lineWidth,
    },
    javascript: {
      formatter: {
        quoteStyle: source.javascript.quoteStyle,
        semicolons: source.javascript.semicolons,
        trailingCommas: source.javascript.trailingCommas,
      },
    },
    linter: { enabled: true, rules },
  };
}

/**
 * Formats through the same Biome the repo lints with, so the written file already passes
 * `biome check` and the check compares exact bytes.
 */
function formatWithBiome(json: string): string {
  return execFileSync(process.execPath, ["x", "biome", "format", "--stdin-file-path=biome.json"], {
    cwd: ROOT,
    encoding: "utf8",
    input: json,
  });
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const source = sourceSchema.parse(JSON.parse(await readFile(SOURCE, "utf8")));
  const expected = formatWithBiome(JSON.stringify(biomeConfigFor(source), null, 2));

  if (check) {
    const current = await readFile(TARGET, "utf8").catch(() => "");
    if (current !== expected) {
      console.error("biome.json is out of date with ultracite.json. Run: bun run ultracite:sync");
      return 1;
    }
    console.log("biome.json matches ultracite.json");
    return 0;
  }
  await writeFile(TARGET, expected);
  console.log("wrote biome.json from ultracite.json");
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
