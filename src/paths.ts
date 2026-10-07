import { join, resolve, sep, isAbsolute } from "node:path";
import { type Resource, type Context, type Project, type Scope } from "./model";
import { scopeRoot } from "./adapters";
import { fail } from "./security";
function map(value: unknown, transform: (s: string) => string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const config = value as Record<string, unknown>;
  return {
    ...config,
    ...(typeof config.command === "string"
      ? { command: transform(config.command) }
      : {}),
  };
}
export function portableConfig(
  config: unknown,
  ctx: Context,
  scope: Scope,
  projects: Project[],
) {
  const bases: [string, string][] = [];
  if (scope.kind === "project")
    bases.push([
      resolve(scopeRoot(ctx, scope, projects)),
      "${SHELLTER_PROJECT}",
    ]);
  bases.push([resolve(ctx.home), "${SHELLTER_HOME}"]);
  return map(config, (s) => {
    for (const [base, token] of bases)
      if (s === base || s.startsWith(base + sep))
        return token + s.slice(base.length);
    return s;
  });
}
export function mappedResource(
  resource: Resource,
  ctx: Context,
  projects: Project[],
): Resource {
  function expand(s: string) {
    for (const [token, root] of [
      ["${SHELLTER_HOME}", ctx.home],
      [
        "${SHELLTER_PROJECT}",
        resource.scope.kind === "project"
          ? scopeRoot(ctx, resource.scope, projects)
          : null,
      ],
    ] as const) {
      if (s === token || s.startsWith(token + "/")) {
        if (!root) fail("missing-mapping", "没有项目路径映射。");
        const result = resolve(root, s.slice(token.length + 1));
        if (result !== resolve(root) && !result.startsWith(resolve(root) + sep))
          fail("unsafe-path", "可移植路径越界。");
        return result;
      }
    }
    if (s.includes("${SHELLTER_"))
      fail(
        "missing-mapping",
        "路径占位符必须是完整 HOME/PROJECT token 或 token 后跟斜线。",
      );
    return s;
  }
  const config = map(resource.config, expand) as Resource["config"];
  if (Array.isArray(config.args))
    config.args = config.args.map((arg, index) => {
      if (typeof arg !== "string") return arg;
      if (resource.pathArguments?.includes(index)) {
        if (
          !arg.startsWith("${SHELLTER_HOME}") &&
          !arg.startsWith("${SHELLTER_PROJECT}")
        )
          fail(
            "missing-mapping",
            "声明为路径的参数需要显式 HOME/PROJECT 占位符映射。",
          );
        return expand(arg);
      }
      if (
        (isAbsolute(arg) ||
          /^[A-Za-z]:[\\/]/.test(arg) ||
          arg.includes("${SHELLTER_")) &&
        !resource.literalArguments?.includes(index)
      )
        fail(
          "missing-mapping",
          "绝对路径参数尚未分类：请审查并用 pathArguments + HOME/PROJECT 占位符映射，或明确声明 literalArguments。参数索引：" +
            index,
        );
      return arg;
    });
  return { ...resource, config };
}
