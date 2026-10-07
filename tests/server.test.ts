import { expect, test } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server";
test("the local application requires a one-use bootstrap, exact origin and a session for sensitive reads", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "shellter-http-")));
  const server = await startServer({ home, state: join(home, "state") });
  try {
    const headers = {
      "Content-Type": "application/json",
      Origin: server.origin,
    };
    const denied = await fetch(server.origin + "/api/command", {
      method: "POST",
      headers,
      body: JSON.stringify({ command: "harness", input: {} }),
    });
    expect(denied.status).toBe(403);
    const bootstrap = await fetch(server.origin + "/api/session", {
      method: "POST",
      headers: {
        ...headers,
        Authorization: "Bearer " + server.url.split("#")[1],
      },
      body: "{}",
    });
    expect(bootstrap.status).toBe(200);
    const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
    expect(bootstrap.headers.get("set-cookie")).toContain("HttpOnly");
    const status = await fetch(server.origin + "/api/status", {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: "{}",
    });
    expect(status.status).toBe(200);
    const response = await fetch(server.origin + "/api/command", {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ command: "harness", input: {} }),
    });
    expect(await response.json()).toEqual({
      result: { formatVersion: 1, resources: [] },
    });
    const cross = await fetch(server.origin + "/api/command", {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.test", Cookie: cookie },
      body: "{}",
    });
    expect(cross.status).toBe(403);
    const repeated = await fetch(server.origin + "/api/session", {
      method: "POST",
      headers: {
        ...headers,
        Authorization: "Bearer " + server.url.split("#")[1],
      },
      body: "{}",
    });
    expect(repeated.status).toBe(403);
  } finally {
    await server.close();
    await rm(home, { recursive: true, force: true });
  }
});
