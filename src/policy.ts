import { z } from "zod";
import { type Harness, type Resource, type Agent } from "./model";
import { fail, hasSecret, portableFile } from "./security";
const reference =
  /^\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}$|^\$[A-Z_][A-Z0-9_]*$/;
const strings = z.record(z.string(), z.string());
const common = {
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: strings.optional(),
};
const schemas = {
  codex: z
    .object({
      ...common,
      http_headers: strings.optional(),
      env_http_headers: strings.optional(),
      bearer_token_env_var: z.string().optional(),
      enabled: z.boolean().optional(),
      startup_timeout_sec: z.number().optional(),
      tool_timeout_sec: z.number().optional(),
      enabled_tools: z.array(z.string()).optional(),
      disabled_tools: z.array(z.string()).optional(),
    })
    .strict(),
  claude: z
    .object({
      ...common,
      type: z.enum(["http", "stdio", "sse"]).optional(),
      headers: strings.optional(),
    })
    .strict(),
  codebuddy: z
    .object({
      ...common,
      type: z.enum(["http", "stdio", "sse"]).optional(),
      headers: strings.optional(),
      disabled: z.boolean().optional(),
    })
    .strict(),
  cursor: z
    .object({
      ...common,
      type: z.enum(["http", "stdio", "sse"]).optional(),
      headers: strings.optional(),
    })
    .strict(),
};
export function portableMcp(config: unknown, agent: Agent) {
  const parsed = schemas[agent].safeParse(config);
  if (!parsed.success)
    fail(
      "review-required",
      "MCP 包含未支持的字段或格式，默认排除；请在原生客户端审查并整理声明。",
    );
  const value = parsed.data as Resource["config"];
  if (value.url && value.command)
    fail("review-required", "MCP 只能选择一种 transport，请先修正声明。");
  for (const field of ["headers", "http_headers"]) {
    const headers = value[field];
    if (headers && typeof headers === "object" && !Array.isArray(headers))
      for (const [key, v] of Object.entries(headers))
        if (
          typeof v !== "string" ||
          (!reference.test(v) &&
            !(
              ["accept", "content-type"].includes(key.toLowerCase()) &&
              [
                "application/json",
                "text/event-stream",
                "application/json, text/event-stream",
              ].includes(v)
            ))
        )
          fail(
            "review-required",
            "自定义 HTTP header 值默认不迁移；请改用环境变量引用。",
          );
  }
  if (hasSecret(value))
    fail("secret", "资源含凭据或疑似秘密，已排除；请改成凭据引用。");
  return value;
}
export function assertPortable(harness: Harness) {
  for (const r of harness.resources) {
    for (const name of Object.keys(r.files)) portableFile(name);
    if (
      Object.keys(r.extensions).length ||
      (r.kind !== "mcp" && Object.keys(r.config).length)
    )
      fail("review-required", "未知扩展默认排除，请单独审查。");
    if (r.kind === "mcp") portableMcp(r.config, r.sourceAgent);
    for (const d of r.dependencies ?? [])
      if (
        !/^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/.test(d.package) ||
        !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(d.version)
      )
        fail(
          "review-required",
          "仅支持合法 npm 包名称和固定版本依赖，请修正声明。",
        );
  }
  if (hasSecret(harness)) fail("secret", "资源包含凭据或疑似秘密，请先修正。");
}
// Native unknown fields and credentials stay local, including in preview.
export function reviewMcp(value: unknown, agent: Agent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    try {
      portableMcp({ [key]: v }, agent);
      result[key] = v;
    } catch {
      result[key] = "[本机字段，值不展示]";
    }
  }
  return result;
}
export function managedProjection(value: unknown, agent: Agent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const keys = new Set(Object.keys(schemas[agent].shape));
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => keys.has(key)),
  );
}
export function localFields(value: unknown, agent: Agent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const keys = new Set(Object.keys(schemas[agent].shape));
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.has(key)),
  );
}
