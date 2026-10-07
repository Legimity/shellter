import { join } from "node:path";
import { parse as parseToml, patch } from "@decimalturn/toml-patch";
import {
  parse as parseJsonc,
  modify,
  applyEdits,
  type ParseError,
} from "jsonc-parser";
import {
  type Agent,
  type Scope,
  type Context,
  type Project,
  type Resource,
} from "./model";
import { fail } from "./security";
export const adapters: Record<
  Agent,
  {
    label: string;
    global: string;
    project: string;
    skills: string;
    instruction: string;
    auth: string;
    notes: string;
  }
> = {
  codex: {
    label: "Codex CLI",
    global: ".codex/config.toml",
    project: ".codex/config.toml",
    skills: ".agents/skills",
    instruction: "AGENTS.md",
    auth: "在原生终端运行 codex mcp login <server-name>；保持原生 consent。",
    notes: "连接探测不证明 Codex 加载；项目配置需要原生信任。",
  },
  claude: {
    label: "Claude Code",
    global: ".claude.json",
    project: ".mcp.json",
    skills: ".claude/skills",
    instruction: "CLAUDE.md",
    auth: "在 Claude Code 内使用 /mcp 选择服务器完成原生 OAuth。",
    notes: "原生 /mcp 检查；不替代项目 trust。",
  },
  codebuddy: {
    label: "CodeBuddy Code CLI",
    global: ".codebuddy/.mcp.json",
    project: ".mcp.json",
    skills: ".codebuddy/skills",
    instruction: "CODEBUDDY.md",
    auth: "使用 CodeBuddy Code CLI 原生 MCP 授权入口；具体命令、callback/scopes 与无浏览器方式待该版本核验。",
    notes: "存在 mcp.json/.mcp.json 文档布局差异；不自动推断加载。",
  },
  cursor: {
    label: "Cursor 编辑器",
    global: ".cursor/mcp.json",
    project: ".cursor/mcp.json",
    skills: ".cursor/skills",
    instruction: ".cursor/rules/shellter.mdc",
    auth: "在 Cursor 编辑器 MCP 设置中使用原生连接/登录入口。",
    notes: "仅编辑器 surface；不要用 CLI/Web OAuth 验收代替。",
  },
};
export function scopeRoot(ctx: Context, scope: Scope, projects: Project[]) {
  if (scope.kind === "global") return ctx.home;
  const p = projects.find((p) => p.id === scope.project);
  if (!p) fail("missing-mapping", "必须明确映射目标项目。");
  return p.path;
}
export function configPath(
  ctx: Context,
  agent: Agent,
  scope: Scope,
  projects: Project[],
) {
  return nativePaths(ctx, agent, scope, projects).config;
}
export function nativePaths(
  ctx: Context,
  agent: Agent,
  scope: Scope = { kind: "global" },
  projects: Project[] = [],
) {
  const root = scopeRoot(ctx, scope, projects);
  if (agent === "claude" && scope.kind === "global") {
    const directory = ctx.claudeConfigDir ?? join(root, ".claude");
    return {
      config: ctx.claudeConfigDir
        ? join(directory, ".claude.json")
        : join(root, ".claude.json"),
      skills: join(directory, "skills"),
      instruction: join(directory, "CLAUDE.md"),
    };
  }
  return {
    config: join(
      root,
      scope.kind === "global"
        ? adapters[agent].global
        : adapters[agent].project,
    ),
    skills: join(root, adapters[agent].skills),
    instruction: join(
      root,
      agent === "codex" && scope.kind === "global"
        ? ".codex/AGENTS.md"
        : adapters[agent].instruction,
    ),
  };
}
export function parseConfig(
  agent: Agent,
  raw: string,
): Record<string, unknown> {
  try {
    if (agent === "codex") return parseToml(raw) as Record<string, unknown>;
    const errors: ParseError[] = [];
    const result = parseJsonc(raw, errors, { allowTrailingComma: true });
    if (
      errors.length ||
      !result ||
      Array.isArray(result) ||
      typeof result !== "object"
    )
      fail("invalid-config", "原生配置格式非法。");
    return result;
  } catch {
    fail("invalid-config", "原生配置无法安全解析，未修改。");
  }
}
export function servers(agent: Agent, raw: string) {
  const doc = parseConfig(agent, raw);
  const value = doc[agent === "codex" ? "mcp_servers" : "mcpServers"];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-config", "MCP 容器格式非法。");
  return value as Record<string, Record<string, unknown>>;
}
export function encodeMcp(resource: Resource, agent: Agent) {
  const source = structuredClone(resource.config) as Record<string, unknown>;
  const isCodex = resource.sourceAgent === "codex";
  if (isCodex && agent !== "codex") {
    if (source.bearer_token_env_var)
      fail(
        "unsupported",
        "不同客户端的 bearer/OAuth 映射需手工确认，不能自动转换。",
      );
    if (source.http_headers) {
      source.headers = source.http_headers;
      delete source.http_headers;
    }
    if (source.env_http_headers)
      fail("unsupported", "env_http_headers 的目标语义未验证。");
    if (source.url) source.type = "http";
  } else if (!isCodex && agent === "codex") {
    if (source.type && source.type !== "http" && source.type !== "stdio")
      fail("unsupported", "Codex transport 映射不支持。");
    delete source.type;
    if (source.headers) {
      source.http_headers = source.headers;
      delete source.headers;
    }
  }
  // Native OAuth declarations only survive on their own agent.
  if (agent !== resource.sourceAgent && (source.auth || source.oauth))
    fail("unsupported", "OAuth 专属声明不能盲目跨客户端转换。");
  return source;
}
export function editServer(
  agent: Agent,
  raw: string,
  name: string,
  value: Record<string, unknown> | undefined,
) {
  const key = agent === "codex" ? "mcp_servers" : "mcpServers";
  const old = raw || (agent === "codex" ? "" : "{}");
  const doc = parseConfig(agent, old);
  let result: string;
  if (agent === "codex") {
    const next = Object.assign(Object.create(null), doc);
    const entries = Object.assign(Object.create(null), doc[key] ?? {});
    if (value === undefined) delete entries[name];
    else entries[name] = value;
    next[key] = entries;
    result = patch(old, next);
  } else
    result = applyEdits(
      old,
      modify(old, [key, name], value, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: old.includes("\r\n") ? "\r\n" : "\n",
        },
      }),
    );
  const changed = servers(agent, result);
  if (
    value !== undefined &&
    JSON.stringify(changed[name]) !== JSON.stringify(value)
  ) {
    // Property order is not semantic; caller validates via canonical values.
    if (
      Object.keys(value).some(
        (k) => JSON.stringify(changed[name]?.[k]) !== JSON.stringify(value[k]),
      )
    )
      fail("invalid-edit", "写入复读验证失败。");
  }
  return result;
}
