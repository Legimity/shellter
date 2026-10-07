import { dependencyStatus } from "./dependencies";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, isAbsolute } from "node:path";
import { hostname } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Resource, type Agent, type Context } from "./model";
import { adapters } from "./adapters";
import { hash, fail } from "./security";
import { canonical } from "./storage";
export function authGuidance(resource: Resource, agent: Agent) {
  return {
    machine: hostname(),
    agent,
    mcp: resource.name,
    configHash: hash(canonical(resource.config)),
    status: "待授权",
    loading: "未能确认 agent 加载",
    observedAt: new Date().toISOString(),
    method: "native-guidance",
    instruction: adapters[agent].auth,
    limitations: adapters[agent].notes,
    headless: "仅使用该原生版本已支持的方式；不支持时需手工完成。",
  };
}
export async function executable(command: string) {
  if (!command || command.includes("\0")) return false;
  const options = isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? "").split(":").map((p) => join(p, command));
  for (const path of options) {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}
function resolveReference(value: string) {
  const match =
    /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Z_][A-Z0-9_]*)$/.exec(
      value,
    );
  if (!match) return value;
  const result = process.env[match[1] ?? match[2]];
  if (!result) fail("authorization-required", "凭据引用尚未在本机绑定。");
  return result;
}
export async function verify(
  resource: Resource,
  agent: Agent,
  ctx: Context,
  approved: boolean,
) {
  if (!approved)
    fail(
      "approval-required",
      "连接验证可能启动 MCP 程序/发送请求，必须明确选择。",
    );
  const base = {
    machine: hostname(),
    agent,
    mcp: resource.name,
    configHash: hash(canonical(resource.config)),
    observedAt: new Date().toISOString(),
    loading: "未能确认 agent 加载",
    method: "independent-probe",
    limitations: "此探测不证明原生 agent 的授权或加载，不读取原生登录 token。",
  };
  const config = resource.config;
  const client = new Client({ name: "shellter-verifier", version: "0.1.0" });
  let transport:
    StdioClientTransport | StreamableHTTPClientTransport | undefined;
  try {
    const dependencies = await dependencyStatus(
      ctx,
      resource.dependencies ?? [],
    );
    if (dependencies.some((d) => d.status !== "版本满足"))
      return {
        ...base,
        status: "依赖缺失",
        dependencies,
        nextAction:
          "已有依赖缺失或固定版本不满足；显式安装并绑定实际本机可执行路径，再重新预览应用。",
      };
    if (config.command === "npx")
      return {
        ...base,
        status: "待配置依赖",
        dependencies,
        nextAction:
          "验证不自动下载或执行 npx 包；请显式安装固定版本并将 command/args 绑定到本机已安装程序后重新预览。",
      };
    if (config.oauth || config.auth)
      return {
        ...authGuidance(resource, agent),
        method: "native-auth-required",
      };
    if (typeof config.url === "string") {
      const url = new URL(config.url);
      if (!["https:", "http:"].includes(url.protocol))
        fail("unsupported", "不支持该 MCP URL 协议。");
      if (config.type === "sse")
        return {
          ...base,
          status: "不支持",
          nextAction: "旧 SSE transport 尚未实现，请用原生客户端确认。",
        };
      const headers: Record<string, string> = {};
      const source = config.headers ?? config.http_headers;
      if (source && typeof source === "object" && !Array.isArray(source))
        for (const [key, value] of Object.entries(source))
          if (typeof value === "string") headers[key] = resolveReference(value);
      if (typeof config.bearer_token_env_var === "string") {
        const value = process.env[config.bearer_token_env_var];
        if (!value)
          fail(
            "authorization-required",
            "需要本机绑定 bearer token 环境变量。",
          );
        headers.Authorization = "Bearer " + value;
      }
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        fetch: async (input, init) =>
          fetch(input, {
            ...init,
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          }),
      });
    } else if (typeof config.command === "string") {
      if (!(await executable(config.command)))
        return {
          ...base,
          status: "依赖缺失",
          nextAction:
            "安装所需运行时/可执行程序，或显式选择受支持 npm 依赖安装。",
        };
      const env: Record<string, string> = {
        HOME: ctx.home,
        PATH: process.env.PATH ?? "",
      };
      if (
        config.env &&
        typeof config.env === "object" &&
        !Array.isArray(config.env)
      )
        for (const [name, value] of Object.entries(config.env))
          if (typeof value === "string") env[name] = resolveReference(value);
      transport = new StdioClientTransport({
        command: config.command,
        args: Array.isArray(config.args)
          ? config.args.filter((s): s is string => typeof s === "string")
          : [],
        env,
        stderr: "ignore",
        cwd: ctx.home,
        maxBufferSize: 1024 * 1024,
      });
    } else
      return {
        ...base,
        status: "不支持",
        nextAction: "缺少 url 或 command，请修正 MCP 声明。",
      };
    await client.connect(transport, { timeout: 5000 });
    const capabilities = client.getServerCapabilities();
    let toolCount: number | undefined;
    if (capabilities?.tools)
      toolCount = (await client.listTools(undefined, { timeout: 5000 })).tools
        .length;
    return {
      ...base,
      status: "连接已验证",
      toolCount,
      nextAction: "在目标原生客户端确认加载；没有调用任何业务工具或模型。",
    };
  } catch (e) {
    const code = (e as { code?: number | string }).code;
    return {
      ...base,
      status:
        code === 401 || code === "authorization-required"
          ? "待授权"
          : code === 403
            ? "权限不足"
            : "失败",
      nextAction:
        code === 401 || code === "authorization-required"
          ? adapters[agent].auth
          : code === 403
            ? "服务器拒绝访问；请确认账号或令牌对该 MCP 的权限与 scopes，并检查 endpoint。重复登录不一定能解决权限不足。"
            : "检查 endpoint、协议、网络、依赖或本机凭据绑定后重试。",
    };
  } finally {
    try {
      await client.close();
    } catch {}
    try {
      await transport?.close();
    } catch {}
  }
}
