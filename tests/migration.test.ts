import { test, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "shellter-check-")));
  roots.push(home);
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "example-server@1.2.3"]\n[mcp_servers.docs.env]\nTOKEN = "${env:SHELLTER_CHECK_TOKEN}"\n',
  );
  const app = createApplication({ home, state: join(home, "state") });
  const scan = await app.scan({ agents: ["codex"], projects: [] });
  await app.adopt(scan.resources);
  return { app, home, ids: scan.resources.map((r) => r.id) };
}
test("passive migration checks expose missing local prerequisites without launching MCP or revealing credentials", async () => {
  const { app, ids } = await fixture();
  vi.stubEnv("SHELLTER_CHECK_TOKEN", "");
  const report = await app.check({
    agents: ["codex"],
    resources: ids,
    projects: [],
  });
  expect(report.resources[0]).toMatchObject({
    configuration: "matched",
    executable: "binding-required",
    credentials: { missing: ["SHELLTER_CHECK_TOKEN"] },
    loading: "unconfirmed",
    authentication: "native-confirmation-required",
  });
  expect(report.resources[0].dependencies[0].status).toBe("missing");
  vi.stubEnv("SHELLTER_CHECK_TOKEN", "private-value-do-not-export");
  const rebound = await app.check({
    agents: ["codex"],
    resources: ids,
    projects: [],
  });
  expect(rebound.resources[0].credentials.missing).toEqual([]);
  expect(JSON.stringify(rebound)).not.toContain("private-value-do-not-export");
});
test("configuration check follows actual target edits and recovery rather than assuming apply means ready", async () => {
  const { app, ids, home } = await fixture();
  expect(
    (await app.check({ agents: ["claude"], resources: ids, projects: [] }))
      .resources[0].configuration,
  ).toBe("missing");
  const plan = await app.plan({
    agents: ["claude"],
    resources: ids,
    projects: [],
  });
  const applied = await app.apply(plan.id);
  expect(
    (await app.check({ agents: ["claude"], resources: ids, projects: [] }))
      .resources[0].configuration,
  ).toBe("matched");
  const target = join(home, ".claude.json");
  const original = await import("node:fs/promises").then((fs) =>
    fs.readFile(target, "utf8"),
  );
  await writeFile(target, '{"mcpServers":{}}');
  expect(
    (await app.check({ agents: ["claude"], resources: ids, projects: [] }))
      .resources[0].configuration,
  ).toBe("different");
  await writeFile(target, original);
  await app.recover(applied.operation);
  expect(
    (await app.check({ agents: ["claude"], resources: ids, projects: [] }))
      .resources[0].configuration,
  ).toBe("missing");
});
test("checks honor global scope and read Skill drift without rewriting it", async () => {
  const { app, home } = await fixture();
  await mkdir(join(home, ".agents/skills/review"), { recursive: true });
  await writeFile(join(home, ".agents/skills/review/SKILL.md"), "# Review\n");
  const scan = await app.scan({ agents: ["codex"], projects: [] });
  const skill = scan.resources.find((r) => r.kind === "skill")!;
  skill.dependencies = [
    { package: "example-server", version: "1.2.3", source: "npm" },
  ];
  await app.adopt(scan.resources);
  const ids = [skill.id];
  expect(
    (
      await app.check({
        agents: ["codex"],
        resources: ids,
        projects: [],
        global: false,
      })
    ).resources,
  ).toEqual([]);
  expect(
    (await app.check({ agents: ["codex"], resources: ids, projects: [] }))
      .resources[0],
  ).toMatchObject({
    configuration: "matched",
    dependencies: [
      { package: "example-server", version: "1.2.3", status: "missing" },
    ],
    authentication: "not-applicable",
    loading: "unconfirmed",
  });
  const file = join(home, ".agents/skills/review/SKILL.md");
  await writeFile(file, "# Changed\n");
  expect(
    (await app.check({ agents: ["codex"], resources: ids, projects: [] }))
      .resources[0].configuration,
  ).toBe("different");
  expect(
    await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8")),
  ).toBe("# Changed\n");
});
