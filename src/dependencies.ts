import { spawn } from "node:child_process";
import { join } from "node:path";
import { type Context } from "./model";
import { fail } from "./security";
import { privateDirectory } from "./storage";
export async function installDependency(
  ctx: Context,
  input: { package: string; version: string; approved: boolean },
) {
  if (!input.approved) fail("approval-required", "安装需要明确选择。");
  if (
    !/^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/.test(input.package) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(input.version)
  )
    fail("invalid-input", "只支持合法 npm 包名称和固定版本。");
  const prefix = join(ctx.state, "dependencies");
  await privateDirectory(prefix);
  const args = [
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--",
    input.package + "@" + input.version,
  ];
  return new Promise<{ status: string; nextAction: string }>((resolve) => {
    const child = spawn("npm", args, {
      shell: false,
      stdio: "ignore",
      env: { PATH: process.env.PATH, HOME: ctx.home },
      timeout: 60000,
    });
    child.once("error", () =>
      resolve({
        status: "失败",
        nextAction: "安装器不可用；请手工安装固定版本后重试。",
      }),
    );
    child.once("close", (code) =>
      resolve({
        status: code === 0 ? "依赖已安装" : "失败",
        nextAction:
          code === 0
            ? "原生 agent 使用依赖仍需显式配置为本机安装路径，重新预览应用后验证。安装未替代实际连接验收。"
            : "检查网络、权限和版本后重试；外部安装不属于配置回退范围。",
      }),
    );
  });
}
export function discoverDependencies(config: Record<string, unknown>) {
  if (config.command !== "npx" || !Array.isArray(config.args)) return [];
  // Only exact, unambiguous pinned invocations are inferred; never execute discovery.
  const args = config.args.filter((a) => a !== "-y" && a !== "--yes");
  const first = args[0];
  if (typeof first !== "string") return [];
  const match =
    /^((?:@[a-z0-9_-]+\/)?[a-z0-9_-]+)@(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)$/.exec(
      first,
    );
  return match
    ? [{ package: match[1], version: match[2], source: "npm" as const }]
    : [];
}
export async function dependencyStatus(
  ctx: Context,
  declarations: { package: string; version: string; source: "npm" }[],
) {
  const { text } = await import("./security");
  const result = [];
  for (const declaration of declarations) {
    if (
      !/^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/.test(declaration.package) ||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(declaration.version)
    )
      fail("unsupported", "当前仅支持 npm 固定版本约束，请先审查依赖声明。");
    const versions = [];
    for (const root of [ctx.home, join(ctx.state, "dependencies")]) {
      const raw = await text(
        join(root, "node_modules", declaration.package, "package.json"),
      );
      if (raw) {
        try {
          versions.push(JSON.parse(raw).version);
        } catch {}
      }
    }
    result.push({
      ...declaration,
      status: versions.includes(declaration.version)
        ? "版本满足"
        : versions.length
          ? "版本不满足"
          : "依赖缺失",
    });
  }
  return result;
}
