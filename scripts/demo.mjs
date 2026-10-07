import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runFile = promisify(execFile);
// A real client profile must never override the demo's isolated HOME.
const demoEnv = { ...process.env };
delete demoEnv.CLAUDE_CONFIG_DIR;
const workspace = await realpath(
  await mkdtemp(join(tmpdir(), "shellter-demo-")),
);
const source = join(workspace, "source"),
  destination = join(workspace, "destination");
const skill =
  "---\nname: review-checklist\ndescription: A small review checklist for the Shellter demo\n---\n# Review checklist\n\n- Read the requirement before reviewing.\n- Check the intended behavior and edge cases.\n- Explain findings with concrete examples.\n";
await mkdir(join(source, ".agents/skills/review-checklist"), {
  recursive: true,
});
await mkdir(destination, { recursive: true });
await writeFile(
  join(source, ".agents/skills/review-checklist/SKILL.md"),
  skill,
);
await mkdir(join(source, ".codex"));
await writeFile(
  join(source, ".codex/config.toml"),
  '# Example declaration only; no live endpoint.\n[mcp_servers.example_docs]\nurl = "https://mcp.example.invalid"\n',
);
const cli = join(root, "dist/cli.js");
async function command(home, ...args) {
  const { stdout } = await runFile(
    process.execPath,
    [cli, "--home", home, "--state", join(home, "state"), ...args],
    { cwd: root, env: demoEnv, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
if (process.argv.includes("--walkthrough")) {
  const scanned = await command(source, "scan", "--agents", "codex");
  const selected = scanned.resources.filter((r) => r.kind === "skill");
  if (selected.length !== 1) throw new Error("Expected exactly one demo Skill");
  await command(source, "adopt", "--file", await writeSource(selected));
  const archive = join(workspace, "harness.zip");
  await command(
    source,
    "export",
    "--output",
    archive,
    "--resources",
    selected[0].id,
  );
  const imported = await command(destination, "import", archive);
  await command(
    destination,
    "adopt",
    "--file",
    await writeSource(imported.resources),
  );
  const plan = await command(
    destination,
    "plan",
    "--agents",
    "claude",
    "--resources",
    selected[0].id,
  );
  if (plan.conflicts.length || plan.changes.length !== 1)
    throw new Error("Unexpected demo plan");
  const applied = await command(destination, "apply", plan.id, "--approve");
  const actual = await readFile(
    join(destination, ".claude/skills/review-checklist/SKILL.md"),
    "utf8",
  );
  if (actual !== skill)
    throw new Error("Transferred content differs from source");
  const restored = await command(
    destination,
    "recover",
    applied.operation,
    "--approve",
  );
  const after = await command(destination, "scan", "--agents", "claude");
  if (after.resources.some((r) => r.kind === "skill"))
    throw new Error("Rollback left managed content");
  console.log("PASS  Scan an isolated Codex fixture and select one Skill");
  console.log("PASS  Adopt, export ZIP, and import into a different HOME");
  console.log("PASS  Review and apply to the Claude configuration location");
  console.log("PASS  Read back identical Skill content");
  console.log("PASS  Recover the operation and confirm removal");
  console.log(
    "Configuration-only demo: no native agent, OAuth, MCP process, or model was run.",
  );
  console.log("Artifacts (temporary fixture data): " + workspace);
} else {
  console.log(
    "Shellter isolated demo — your actual agent configuration is not scanned or modified.",
  );
  console.log("Fixture directory: " + workspace);
  console.log(
    "Scan Codex, select review-checklist, adopt it, then choose Claude and preview/apply.",
  );
  console.log(
    "The example MCP URL is intentionally non-live; use the Skill for this walkthrough.",
  );
  const child = spawn(
    process.execPath,
    [
      cli,
      "--home",
      source,
      "--state",
      join(source, "state"),
      "serve",
      "--demo",
    ],
    { cwd: root, env: demoEnv, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.once("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
async function writeSource(resources) {
  const path = join(workspace, "selected.json");
  await writeFile(path, JSON.stringify({ resources }), { mode: 0o600 });
  return path;
}
