import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
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
    await mkdtemp(join(tmpdir(), "shellter-usability-")),
  );
  roots.push(home);
  await mkdir(join(home, ".agents/skills/review"), { recursive: true });
  await writeFile(join(home, ".agents/skills/review/SKILL.md"), "# Source\n");
  const app = createApplication({ home, state: join(home, "state") });
  await app.adopt(
    (await app.scan({ agents: ["codex"], projects: [] })).resources,
  );
  return { home, app };
}
test("a blocked Skill conflict can be reviewed without authorizing overwrite", async () => {
  const { home, app } = await fixture();
  const target = join(home, ".claude/skills/review/SKILL.md");
  await mkdir(join(home, ".claude/skills/review"), { recursive: true });
  await writeFile(target, "# Existing customization\n");
  const plan = await app.plan({ agents: ["claude"], projects: [] });
  expect(plan.conflicts).toHaveLength(1);
  expect(plan.changes).toEqual([]);
  expect(plan.review).toEqual([
    expect.objectContaining({
      target,
      before: "# Existing customization\n",
      after: "# Source\n",
    }),
  ]);
  await expect(app.apply(plan.id)).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(target, "utf8")).toBe("# Existing customization\n");
});
test("a rejected linked state path identifies the link and suggests an explicit real path without writing", async () => {
  const { home } = await fixture();
  const alias = join(home, "alias");
  await symlink(home, alias);
  const app = createApplication({ home, state: join(alias, "new-state") });
  await expect(app.adopt([])).rejects.toMatchObject({
    code: "unsafe-path",
    message: expect.stringContaining(alias),
  });
  await expect(app.adopt([])).rejects.toMatchObject({
    message: expect.stringContaining(join(home, "new-state")),
  });
  await expect(
    readFile(join(home, "new-state/harness.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
test("recovery inspection identifies later edits without exposing journal contents or overwriting them", async () => {
  const { home, app } = await fixture();
  const target = join(home, ".claude/skills/review/SKILL.md");
  await mkdir(join(home, ".claude/skills/review"), { recursive: true });
  await writeFile(target, "password=private-original-value\n");
  const plan = await app.plan({
    agents: ["claude"],
    projects: [],
    overwrite: true,
  });
  const result = await app.apply(plan.id);
  expect((await app.recoveryCheck(result.operation)).entries).toEqual([
    expect.objectContaining({ target, state: "ready" }),
  ]);
  await writeFile(target, "# Later user edit\n");
  const report = await app.recoveryCheck(result.operation);
  expect(report.entries).toEqual([
    expect.objectContaining({
      target,
      state: "changed",
      backupAvailable: true,
    }),
  ]);
  expect(JSON.stringify(report)).not.toContain("private-original-value");
  await expect(app.recover(result.operation)).rejects.toMatchObject({
    code: "drift",
    message: expect.stringContaining(target),
  });
  expect(await readFile(target, "utf8")).toBe("# Later user edit\n");
});

test("recovery inspection of a missing state is actionable and does not create it", async () => {
  const { home } = await fixture();
  const state = join(home, "missing-state");
  const app = createApplication({ home, state });
  await expect(
    app.recoveryCheck("00000000-0000-0000-0000-000000000000"),
  ).rejects.toMatchObject({ code: "not-found" });
  await expect(readFile(join(state, "journal"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
test("recovery inspection distinguishes edits after a completed recovery", async () => {
  const { home, app } = await fixture();
  const plan = await app.plan({ agents: ["claude"], projects: [] });
  const result = await app.apply(plan.id);
  await app.recover(result.operation);
  const target = join(home, ".claude/skills/review/SKILL.md");
  await writeFile(target, "# Edit after recovery\n");
  expect((await app.recoveryCheck(result.operation)).entries[0]?.state).toBe(
    "changed-after-recovery",
  );
  await app.recover(result.operation);
  expect(await readFile(target, "utf8")).toBe("# Edit after recovery\n");
});
