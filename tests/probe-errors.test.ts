import { afterEach, expect, test } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/application";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

test.each([
  [401, "待授权"],
  [403, "权限不足"],
  [500, "失败"],
] as const)(
  "MCP HTTP %i produces actionable status without disclosing response content",
  async (status, expected) => {
    const endpoint = createServer((_req, res) => {
      res.writeHead(status).end("private upstream diagnostic must not escape");
    });
    await new Promise<void>((resolve) =>
      endpoint.listen(0, "127.0.0.1", resolve),
    );
    const address = endpoint.address();
    if (!address || typeof address === "string") throw new Error();
    try {
      const home = await realpath(
        await mkdtemp(join(tmpdir(), "shellter-probe-")),
      );
      roots.push(home);
      const app = createApplication({ home, state: join(home, "state") });
      await app.adopt([
        {
          id: "probe",
          name: "probe",
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
      const result = await app.verify("probe", "claude", true);
      expect(result.status).toBe(expected);
      expect(result).toMatchObject({ loading: "未能确认 agent 加载" });
      expect(JSON.stringify(result)).not.toContain(
        "private upstream diagnostic",
      );
    } finally {
      endpoint.closeAllConnections();
      await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    }
  },
);
