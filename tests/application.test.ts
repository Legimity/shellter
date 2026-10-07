import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function sandbox() {
  const home = await mkdtemp(join(tmpdir(), "shellter-"));
  roots.push(home);
  return await realpath(home);
}
test("scan exposes credential references while excluding actual secrets from public results", async () => {
  const home = await sandbox();
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.docs]\nurl = "https://mcp.example.test"\nbearer_token_env_var = "DOCS_TOKEN"\n[mcp_servers.unsafe]\nurl = "https://mcp.example.test?access_token=never-export-this"\n',
  );
  const app = createApplication({ home, state: join(home, "state") });
  const result = await app.scan({ agents: ["codex"], projects: [] });
  expect(result.resources).toHaveLength(1);
  expect(result.resources[0].config.bearer_token_env_var).toBe("DOCS_TOKEN");
  expect(JSON.stringify(result)).not.toContain("never-export-this");
  expect(result.warnings.some((x) => x.code === "excluded-secret")).toBe(true);
});
test("a reviewed plan preserves unrelated TOML, rejects drift, applies and rolls back", async () => {
  const home = await sandbox();
  await mkdir(join(home, ".codex"));
  const original =
    '# Keep this comment\nmodel = "custom"\n[mcp_servers.docs]\nurl = "https://mcp.example.test"\n';
  const target = join(home, ".codex/config.toml");
  await writeFile(target, original);
  const app = createApplication({ home, state: join(home, "state") });
  const scanned = await app.scan({ agents: ["codex"], projects: [] });
  await app.adopt(scanned.resources);
  scanned.resources[0].config.url = "https://new.example.test";
  await app.adopt(scanned.resources);
  const plan = await app.plan({
    agents: ["codex"],
    projects: [],
    overwrite: true,
  });
  expect(plan.conflicts).toEqual([]);
  expect(plan.changes).toHaveLength(1);
  await writeFile(target, original + "# Changed after preview\n");
  await expect(app.apply(plan.id)).rejects.toMatchObject({ code: "drift" });
  await writeFile(target, original);
  const outcome = await app.apply(plan.id);
  expect(outcome.status).toBe("配置已应用");
  const updated = await app.nativeConfiguration({
    agent: "codex",
    scope: { kind: "global" },
    projects: [],
  });
  expect(updated).toContain("# Keep this comment");
  expect(updated).toContain('model = "custom"');
  expect(updated).toContain("https://new.example.test");
  await app.recover(outcome.operation);
  expect(
    await app.nativeConfiguration({
      agent: "codex",
      scope: { kind: "global" },
      projects: [],
    }),
  ).toBe(original);
});
test("a selected project skill travels as actual content and maps to another home without credentials", async () => {
  const home = await sandbox(),
    destination = await sandbox();
  const project = join(home, "project"),
    newProject = join(destination, "other");
  await mkdir(join(project, ".agents/skills/helper"), { recursive: true });
  await mkdir(newProject);
  await writeFile(
    join(project, ".agents/skills/helper/SKILL.md"),
    "---\nname: helper\n---\nKeep this instruction.",
  );
  const app = createApplication({ home, state: join(home, "state") });
  const scan = await app.scan({
    agents: ["codex"],
    projects: [{ id: "work", path: project }],
  });
  expect(scan.resources.filter((r) => r.kind === "skill")).toHaveLength(1);
  await app.adopt(scan.resources);
  const archive = join(home, "harness.zip");
  await app.exportBundle({
    path: archive,
    resources: scan.resources.map((r) => r.id),
  });
  const next = createApplication({
    home: destination,
    state: join(destination, "state"),
  });
  const imported = await next.importBundle(archive);
  await next.adopt(imported.resources);
  const plan = await next.plan({
    agents: ["claude", "codebuddy", "cursor"],
    projects: [{ id: "work", path: newProject }],
  });
  expect(plan.conflicts).toEqual([]);
  expect(plan.changes).toHaveLength(3);
  const result = await next.apply(plan.id);
  expect(result.status).toBe("配置已应用");
  const verified = await next.scan({
    agents: ["claude", "codebuddy", "cursor"],
    projects: [{ id: "work", path: newProject }],
  });
  expect(verified.resources.filter((r) => r.kind === "skill")).toHaveLength(3);
  expect(
    verified.resources.every((r) =>
      Object.values(r.files).every((s) => s.includes("Keep this instruction.")),
    ),
  ).toBe(true);
});
test("import refuses path traversal and adopt refuses actual environment values", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await expect(
    app.adopt([
      {
        id: "safe",
        name: "server",
        kind: "mcp",
        scope: { kind: "global" },
        sourceAgent: "claude",
        config: { command: "node", env: { TOKEN: "plain-secret-canary" } },
        files: {},
        extensions: {},
      },
    ]),
  ).rejects.toMatchObject({ code: "secret" });
  const { zipSync, strToU8 } = await import("fflate");
  const path = join(home, "hostile.zip");
  await writeFile(path, zipSync({ "../outside": strToU8("danger") }));
  await expect(app.importBundle(path)).rejects.toMatchObject({
    code: "unsafe-path",
  });
});
test("verification does not claim another agent is configured merely because the source can connect", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await app.adopt([
    {
      id: "remote",
      name: "remote",
      kind: "mcp",
      scope: { kind: "global" },
      sourceAgent: "codex",
      config: { url: "http://127.0.0.1:1" },
      files: {},
      extensions: {},
    },
  ]);
  const result = await app.verify("remote", "claude", true);
  expect(result.status).toBe("配置未应用");
  expect(result.method).toBe("native-config-check");
});
test("explicit MCP verification initializes and discovers tools without invoking tools or models", async () => {
  const { createServer } = await import("node:http");
  const methods: string[] = [];
  const endpoint = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    methods.push(request.method);
    if (request.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : {
            tools: [
              {
                name: "safe",
                description: "not invoked",
                inputSchema: { type: "object" },
              },
            ],
          };
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  await new Promise<void>((resolve) =>
    endpoint.listen(0, "127.0.0.1", resolve),
  );
  const address = endpoint.address();
  if (!address || typeof address === "string") throw new Error();
  try {
    const home = await sandbox(),
      app = createApplication({ home, state: join(home, "state") });
    await app.adopt([
      {
        id: "remote",
        name: "remote",
        kind: "mcp",
        scope: { kind: "global" },
        sourceAgent: "codex",
        config: { url: `http://127.0.0.1:${address.port}/mcp` },
        files: {},
        extensions: {},
      },
    ]);
    const plan = await app.plan({ agents: ["claude"], projects: [] });
    await app.apply(plan.id);
    await expect(app.verify("remote", "claude", false)).rejects.toMatchObject({
      code: "approval-required",
    });
    const result = await app.verify("remote", "claude", true);
    expect(result.status).toBe("连接已验证");
    expect(result).toMatchObject({
      method: "independent-probe",
      loading: "未能确认 agent 加载",
      toolCount: 1,
    });
    expect(methods).toContain("initialize");
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
  }
});
test("archive expansion is bounded even when ZIP size metadata lies", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  const { zipSync } = await import("fflate");
  const bytes = zipSync(
    { "resources/safe/large.txt": new Uint8Array(5 * 1024 * 1024).fill(65) },
    { level: 9 },
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(22, 1, true);
  for (let i = 0; i < bytes.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 1, true);
      break;
    }
  const file = join(home, "lying.zip");
  await writeFile(file, bytes);
  await expect(app.importBundle(file)).rejects.toMatchObject({
    code: "oversized",
  });
});

test("unknown MCP fields never leave the native config and arbitrary argument data is not remapped", async () => {
  const home = await sandbox();
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.private]\ncommand="node"\nsession="opaque-canary"\n[mcp_servers.safe]\ncommand="' +
      home +
      '/bin/server"\nargs=["' +
      home +
      '/literal-data"]\n',
  );
  const app = createApplication({ home, state: join(home, "state") });
  const scan = await app.scan({ agents: ["codex"], projects: [] });
  expect(JSON.stringify(scan)).not.toContain("opaque-canary");
  expect(scan.resources).toHaveLength(1);
  expect(scan.resources[0].config.command).toBe("${SHELLTER_HOME}/bin/server");
  expect(scan.resources[0].config.args).toEqual([home + "/literal-data"]);
  await expect(
    app.adopt([
      {
        ...scan.resources[0],
        config: { command: "node", session: "opaque-canary" },
      },
    ]),
  ).rejects.toMatchObject({ code: "review-required" });
});
test("review contains actual managed values while preserving undisclosed machine-local fields", async () => {
  const home = await sandbox();
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.docs]\nurl="https://old.example.test"\nsession="local-canary"\n',
  );
  const app = createApplication({ home, state: join(home, "state") });
  await app.adopt([
    {
      id: "docs",
      name: "docs",
      kind: "mcp",
      scope: { kind: "global" },
      sourceAgent: "codex",
      config: { url: "https://new.example.test" },
      files: {},
      extensions: {},
    },
  ]);
  const plan = await app.plan({
    agents: ["codex"],
    projects: [],
    overwrite: true,
  });
  expect(JSON.stringify(plan)).toContain("https://old.example.test");
  expect(JSON.stringify(plan)).toContain("https://new.example.test");
  expect(JSON.stringify(plan)).not.toContain("local-canary");
  await app.apply(plan.id);
  expect(
    await app.nativeConfiguration({
      agent: "codex",
      scope: { kind: "global" },
      projects: [],
    }),
  ).toContain('session="local-canary"');
});
test("a killed writer exposes owner nonces and explicitly recovers its journaled writes", async () => {
  const { spawn } = await import("node:child_process");
  const home = await sandbox(),
    state = join(home, "state"),
    app = createApplication({ home, state });
  const files: Record<string, string> = { "SKILL.md": "# Recoverable skill" };
  for (let i = 0; i < 80; i++)
    files[`file-${i}.txt`] = "recover me ".repeat(100);
  await app.adopt([
    {
      id: "skill",
      name: "skill",
      kind: "skill",
      scope: { kind: "global" },
      sourceAgent: "codex",
      config: {},
      files,
      extensions: {},
    },
  ]);
  const plan = await app.plan({ agents: ["claude"], projects: [] });
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {createApplication} from './src/application.ts'; await createApplication(${JSON.stringify({ home, state })}).apply(${JSON.stringify(plan.id)});`,
    ],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let interrupted: string | undefined;
  try {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && child.exitCode === null) {
      const history = await app.history();
      const active = history.find(
        (o) =>
          o.status === "applying" &&
          o.entries.some((e) => e.stage === "applied"),
      );
      if (active) {
        interrupted = active.id;
        child.kill("SIGKILL");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(interrupted).toBeDefined();
    await exited;
    const locks = await app.locks(interrupted!);
    expect(locks.length).toBeGreaterThan(1);
    expect(locks.every((o) => !o.running)).toBe(true);
    await expect(app.recover(interrupted!)).rejects.toMatchObject({
      code: "locked",
    });
    await expect(app.unlock(interrupted!, [], true)).rejects.toMatchObject({
      code: "drift",
    });
    await app.unlock(
      interrupted!,
      locks.map((o) => o.nonce),
      true,
    );
    expect((await app.recover(interrupted!)).status).toBe("已回退配置");
    const scanned = await app.scan({ agents: ["claude"], projects: [] });
    expect(scanned.resources).toHaveLength(0);
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
}, 15000);

test("pinned npm dependencies are discovered and a wrong installed version blocks execution", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await mkdir(join(home, ".claude"));
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        pinned: { command: "npx", args: ["-y", "fixture-server@1.2.3"] },
      },
    }),
  );
  const scan = await app.scan({ agents: ["claude"], projects: [] });
  expect(scan.resources[0].dependencies).toEqual([
    { package: "fixture-server", version: "1.2.3", source: "npm" },
  ]);
  await app.adopt(scan.resources);
  await mkdir(join(home, "node_modules/fixture-server"), { recursive: true });
  await writeFile(
    join(home, "node_modules/fixture-server/package.json"),
    JSON.stringify({ version: "9.9.9" }),
  );
  const result = await app.verify(scan.resources[0].id, "claude", true);
  expect(result.status).toBe("依赖缺失");
  expect(result).toMatchObject({ dependencies: [{ status: "版本不满足" }] });
});

test("transport switching removes obsolete managed fields and rejects unsupported permissions", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.docs]\ncommand="node"\nargs=["old.js"]\nsession="keep-local"\n[mcp_servers.docs.env]\nOLD="${OLD}"\n',
  );
  const resource = {
    id: "docs",
    name: "docs",
    kind: "mcp" as const,
    scope: { kind: "global" as const },
    sourceAgent: "codex" as const,
    config: { url: "https://new.example.test" },
    files: {},
    extensions: {},
  };
  await app.adopt([resource]);
  const plan = await app.plan({
    agents: ["codex"],
    projects: [],
    overwrite: true,
  });
  await app.apply(plan.id);
  const native = await app.nativeConfiguration({
    agent: "codex",
    scope: { kind: "global" },
    projects: [],
  });
  expect(native).not.toContain("command");
  expect(native).not.toContain("args");
  expect(native).not.toContain("OLD");
  expect(native).toContain("keep-local");
  await app.adopt([
    {
      ...resource,
      config: { ...resource.config, disabled_tools: ["dangerous"] },
    },
  ]);
  const cross = await app.plan({ agents: ["claude"], projects: [] });
  expect(cross.conflicts).toHaveLength(1);
  await expect(app.apply(cross.id)).rejects.toMatchObject({ code: "conflict" });
});
test("absolute launch arguments require an explicit portable mapping or literal classification", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  const resource = {
    id: "local",
    name: "local",
    kind: "mcp" as const,
    scope: { kind: "global" as const },
    sourceAgent: "claude" as const,
    config: { command: "node", args: ["/other-home/server.js"] },
    files: {},
    extensions: {},
  };
  await app.adopt([resource]);
  const blocked = await app.plan({ agents: ["claude"], projects: [] });
  expect(blocked.conflicts).toHaveLength(1);
  await expect(app.apply(blocked.id)).rejects.toMatchObject({
    code: "conflict",
  });
  await app.adopt([
    {
      ...resource,
      config: { command: "node", args: ["${SHELLTER_HOME}/server.js"] },
      pathArguments: [0],
    },
  ]);
  const mapped = await app.plan({ agents: ["claude"], projects: [] });
  expect(mapped.conflicts).toEqual([]);
  expect(JSON.stringify(mapped.review)).toContain(home + "/server.js");
});

test("distinct MCP servers share a config file without a false collision", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(home, ".codex/config.toml"),
    '[mcp_servers.one]\nurl="https://old-one.test"\n[mcp_servers.two]\nurl="https://old-two.test"\n',
  );
  const resources = ["one", "two"].map((name) => ({
    id: name,
    name,
    kind: "mcp" as const,
    sourceAgent: "codex" as const,
    scope: { kind: "global" as const },
    config: { url: `https://new-${name}.test` },
    files: {},
    extensions: {},
  }));
  await app.adopt(resources);
  const plan = await app.plan({
    agents: ["codex"],
    projects: [],
    overwrite: true,
  });
  expect(plan.conflicts).toEqual([]);
  expect(plan.review).toHaveLength(2);
  await app.apply(plan.id);
  const native = await app.nativeConfiguration({
    agent: "codex",
    scope: { kind: "global" },
    projects: [],
  });
  expect(native).toContain("https://new-one.test");
  expect(native).toContain("https://new-two.test");
  await app.adopt([
    {
      ...resources[0],
      id: "collision",
      config: { url: "https://different.test" },
    },
  ]);
  const duplicate = await app.plan({
    agents: ["codex"],
    projects: [],
    overwrite: true,
  });
  expect(duplicate.conflicts.some((c) => c.code === "duplicate-target")).toBe(
    true,
  );
});
test("malformed portable placeholders block classified launch arguments", async () => {
  const home = await sandbox(),
    app = createApplication({ home, state: join(home, "state") });
  await app.adopt([
    {
      id: "bad",
      name: "bad",
      kind: "mcp",
      sourceAgent: "claude",
      scope: { kind: "global" },
      config: { command: "node", args: ["${SHELLTER_HOME}server.js"] },
      pathArguments: [0],
      files: {},
      extensions: {},
    },
  ]);
  const plan = await app.plan({ agents: ["claude"], projects: [] });
  expect(plan.conflicts).toHaveLength(1);
  await expect(app.apply(plan.id)).rejects.toMatchObject({ code: "conflict" });
});
