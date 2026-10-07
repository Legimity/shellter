import { test, expect, afterEach } from "vitest";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await realpath(
    await mkdtemp(join(tmpdir(), "shellter-profiles-")),
  );
  roots.push(home);
  return home;
}
test("custom Claude configuration directory is used consistently for scan, plan, check and recovery", async () => {
  const home = await fixture(),
    claudeConfigDir = join(home, ".tclaude");
  await mkdir(join(home, ".agents/skills/review"), { recursive: true });
  await writeFile(
    join(home, ".agents/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review changes\n---\n# Review\n",
  );
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.docs]\nurl="https://example.invalid/mcp"\n',
  );
  await mkdir(claudeConfigDir);
  await writeFile(join(claudeConfigDir, ".claude.json"), '{"theme":"dark"}\n');
  await writeFile(join(home, ".claude.json"), '{"existing":"untouched"}\n');
  const app = createApplication({
    home,
    state: join(home, "state"),
    claudeConfigDir,
  });
  const source = await app.scan({ agents: ["codex"], projects: [] });
  await app.adopt(source.resources);
  const ids = source.resources.map((r) => r.id);
  const plan = await app.plan({
    agents: ["claude"],
    resources: ids,
    projects: [],
  });
  expect(plan.conflicts).toEqual([]);
  expect(plan.changes.map((c) => c.target).sort()).toEqual([
    join(claudeConfigDir, ".claude.json"),
    join(claudeConfigDir, "skills/review/SKILL.md"),
  ]);
  const op = await app.apply(plan.id);
  expect(
    (
      await app.check({ agents: ["claude"], resources: ids, projects: [] })
    ).resources.map((r) => r.configuration),
  ).toEqual(["matched", "matched"]);
  expect(
    (await app.scan({ agents: ["claude"], projects: [] })).resources
      .map((r) => r.name)
      .sort(),
  ).toEqual(["docs", "review"]);
  expect(await readFile(join(home, ".claude.json"), "utf8")).toBe(
    '{"existing":"untouched"}\n',
  );
  await app.recover(op.operation);
  expect(await readFile(join(claudeConfigDir, ".claude.json"), "utf8")).toBe(
    '{"theme":"dark"}\n',
  );
});
test("excluded MCP warnings identify the resource and file without exposing its secret", async () => {
  const home = await fixture();
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.private_docs]\nurl="https://example.invalid/mcp"\n[mcp_servers.private_docs.http_headers]\nAuthorization="Bearer private-secret-value"\n',
  );
  const app = createApplication({ home, state: join(home, "state") });
  const scan = await app.scan({ agents: ["codex"], projects: [] });
  expect(scan.resources).toEqual([]);
  expect(scan.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "private_docs",
        path: join(home, ".codex/config.toml"),
      }),
    ]),
  );
  expect(JSON.stringify(scan)).not.toContain("private-secret-value");
});
test("global instruction locations differ from project instruction locations", async () => {
  const home = await fixture(),
    project = join(home, "project"),
    claudeConfigDir = join(home, ".tclaude");
  await mkdir(join(home, ".codex"));
  await mkdir(project);
  await mkdir(claudeConfigDir);
  await writeFile(join(home, ".codex/AGENTS.md"), "Global Codex guidance\n");
  await writeFile(join(project, "AGENTS.md"), "Project Codex guidance\n");
  await writeFile(
    join(claudeConfigDir, "CLAUDE.md"),
    "Global Claude guidance\n",
  );
  const app = createApplication({
    home,
    state: join(home, "state"),
    claudeConfigDir,
  });
  const scan = await app.scan({
    agents: ["codex", "claude"],
    projects: [{ id: "work", path: project }],
  });
  expect(
    scan.resources
      .filter((r) => r.kind === "instruction")
      .map((r) => Object.values(r.files)[0]),
  ).toEqual([
    "Global Codex guidance\n",
    "Project Codex guidance\n",
    "Global Claude guidance\n",
  ]);
});
