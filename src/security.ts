import { createHash } from "node:crypto";
import {
  lstat,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { ShellterError } from "./model";
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function fail(code: string, message: string): never {
  throw new ShellterError(code, message);
}
export function portableFile(name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((p) => !p || p === "." || p === "..") ||
    /^[a-z]:/i.test(name)
  )
    fail("unsafe-path", "资源包含非法相对路径。");
  return name;
}
export function contained(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    fail("unsafe-path", "路径超出指定范围。");
  return resolve(path);
}
export async function checkPath(path: string) {
  const resolved = resolve(path);
  let cursor = resolved;
  for (;;) {
    try {
      const s = await lstat(cursor);
      if (s.isSymbolicLink()) {
        let candidate: string | undefined;
        try {
          candidate = resolve(
            await realpath(cursor),
            relative(cursor, resolved),
          );
        } catch {}
        fail(
          "unsafe-path",
          `Symbolic link blocked: ${cursor}. Requested path: ${resolved}. ${candidate ? `Resolved candidate: ${candidate}. Inspect this location, then explicitly use its real path and retry.` : "The link cannot be resolved. Inspect or repair it before retrying."} Shellter has not followed the link for this operation.`,
        );
      }
      if (cursor === resolved && !s.isFile() && !s.isDirectory())
        fail("unsafe-path", "拒绝特殊文件。");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolved;
}
export async function text(path: string, maximum = 4 * 1024 * 1024) {
  await checkPath(path);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maximum)
      fail("oversized", "配置文件过大或不是普通文件。");
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function atomic(path: string, content: string) {
  await checkPath(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await checkPath(path);
  const temp = path + ".shellter-" + crypto.randomUUID();
  try {
    await writeFile(temp, content, { mode: 0o600, flag: "wx" });
    await checkPath(path);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
const reference = (s: string) =>
  /^\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}$/.test(s) ||
  /^\$[A-Z_][A-Z0-9_]*$/.test(s);
const sensitiveKey =
  /(?:api.?key|password|passwd|client.?secret|access.?token|refresh.?token|private.?key|authorization|bearer.?token|cookie|credential)/i;
export function hasSecret(value: unknown, key = ""): boolean {
  if (key === "env" && value && typeof value === "object")
    return Object.values(value).some(
      (v) => typeof v !== "string" || !reference(v),
    );
  if (key === "__proto__" || key === "constructor" || key === "prototype")
    return true;
  if (key.endsWith("_env_var"))
    return typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  if (typeof value === "string") {
    if (reference(value)) return false;
    if (/^https?:/i.test(value)) {
      try {
        const url = new URL(value);
        if (
          url.username ||
          url.password ||
          [...url.searchParams.keys()].some(
            (k) => sensitiveKey.test(k) || k === "token",
          )
        )
          return true;
      } catch {
        return true;
      }
    }
    if (sensitiveKey.test(key) && value.length > 0) return true;
    return /-----BEGIN .*PRIVATE KEY|\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|Bearer\s+\S+|(?:access_token|api_key|password|secret)=(?!\(\)(?:\s|$))\S+/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some((x) => hasSecret(x, key));
  if (value && typeof value === "object")
    return Object.entries(value).some(([k, v]) => hasSecret(v, k));
  return false;
}
export function redact(message: string) {
  return message
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----/g, "[redacted]")
    .replace(
      /(?:Bearer\s+|sk-|ghp_|github_pat_|xox[baprs]-)\S+/gi,
      "[redacted]",
    )
    .slice(0, 500);
}
export function checkedJson<T>(value: unknown, parse: (x: unknown) => T): T {
  try {
    return parse(value);
  } catch {
    fail("invalid-input", "输入不符合版本化数据格式。");
  }
}
