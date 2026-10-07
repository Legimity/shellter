import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { type Context, ShellterError } from "./model";
import { createCommands } from "./commands";
import { nativePaths } from "./adapters";
import { agents } from "./model";
const matches = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: IncomingMessage) {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4 * 1024 * 1024)
      throw new ShellterError("oversized", "请求过大。");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ShellterError("invalid-input", "请求不是合法 JSON。");
  }
}
export async function startServer(
  ctx: Context,
  options: { port?: number; webRoot?: string; demo?: boolean } = {},
) {
  const commands = createCommands(ctx),
    bootstrap = randomBytes(32).toString("hex"),
    session = randomBytes(32).toString("hex");
  let consumed = false,
    origin = "",
    busy = false;
  const environment = {
    demo: options.demo === true,
    home: ctx.home,
    locations: Object.fromEntries(
      agents.map((agent) => [agent, nativePaths(ctx, agent)]),
    ),
  };
  const webRoot =
    options.webRoot ?? join(dirname(fileURLToPath(import.meta.url)), "web");
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.host !== new URL(origin).host) {
        json(403, { error: "forbidden-host" });
        return;
      }
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname.startsWith("/api/")) {
        if (
          req.method !== "POST" ||
          req.headers.origin !== origin ||
          req.headers["content-type"] !== "application/json"
        ) {
          json(403, { error: "forbidden-origin-or-method" });
          return;
        }
        if (url.pathname === "/api/session") {
          if (
            consumed ||
            !matches(req.headers.authorization ?? "", "Bearer " + bootstrap)
          ) {
            json(403, { error: "invalid-session" });
            return;
          }
          consumed = true;
          res.setHeader(
            "Set-Cookie",
            `shellter_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
          );
          json(200, { ok: true, environment });
          return;
        }
        const cookie =
          (req.headers.cookie ?? "")
            .split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("shellter_session="))
            ?.slice("shellter_session=".length) ?? "";
        if (!matches(cookie, session)) {
          json(403, { error: "invalid-session" });
          return;
        }
        if (url.pathname === "/api/status") {
          json(200, { ok: true, environment });
          return;
        }
        if (url.pathname !== "/api/command") {
          json(404, { error: "not-found" });
          return;
        }
        const payload = await body(req);
        if (!payload || typeof payload.command !== "string") {
          json(400, { error: "invalid-input" });
          return;
        }
        if (busy) {
          json(409, { error: "busy", message: "操作正在执行，请稍后重试。" });
          return;
        }
        busy = true;
        try {
          json(200, {
            result: await commands.execute(payload.command, payload.input),
          });
        } finally {
          busy = false;
        }
        return;
      }
      if (req.method !== "GET") {
        json(405, { error: "method-not-allowed" });
        return;
      }
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      if (!/^(?:assets\/[a-zA-Z0-9_.-]+|index.html)$/.test(relative)) {
        json(404, { error: "not-found" });
        return;
      }
      const file = await readFile(join(webRoot, relative));
      res.setHeader(
        "Content-Type",
        relative.endsWith(".js")
          ? "text/javascript"
          : relative.endsWith(".css")
            ? "text/css"
            : relative.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html",
      );
      res.end(file);
    } catch (e) {
      json(e instanceof ShellterError ? 400 : 500, {
        error: e instanceof ShellterError ? e.code : "operation-failed",
        message:
          e instanceof ShellterError
            ? e.message
            : "操作失败，请检查配置、路径或权限后重试。",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin + "/#" + bootstrap,
    origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
