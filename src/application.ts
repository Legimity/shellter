import { checkResource } from "./migration";
import {
  assertPortable,
  portableMcp,
  reviewMcp,
  localFields,
  managedProjection,
} from "./policy";
import { portableConfig, mappedResource } from "./paths";
import { authGuidance, verify as probe } from "./verification";
import { installDependency, discoverDependencies } from "./dependencies";
import { scanFiles } from "./resources";
import { exportBundle as exportFile, importBundle } from "./bundle";
import { mkdir } from "node:fs/promises";
import { Storage, canonical, lock, privateDirectory } from "./storage";
import { join, resolve } from "node:path";
import {
  type Context,
  type ScanInput,
  type ScanResult,
  resourceSchema,
  harnessSchema,
  type Resource,
  type PlanInput,
  type Plan,
  type Change,
  type Agent,
  type Scope,
  type Project,
} from "./model";
import {
  configPath,
  servers,
  encodeMcp,
  editServer,
  nativePaths,
} from "./adapters";
import {
  text,
  hasSecret,
  hash,
  checkedJson,
  fail,
  atomic,
  checkPath,
  portableFile,
} from "./security";
export function createApplication(context: Context) {
  const ctx = {
    home: resolve(context.home),
    state: resolve(context.state),
    claudeConfigDir: context.claudeConfigDir
      ? resolve(context.claudeConfigDir)
      : undefined,
  };
  async function scan(input: ScanInput): Promise<ScanResult> {
    const resources: ScanResult["resources"] = [];
    const warnings: ScanResult["warnings"] = [];
    for (const agent of input.agents) {
      warnings.push({
        code: "native-unverified",
        message: `${agent} 扫描仅检查本地配置；请在目标客户端确认实际加载、运行和授权。`,
      });
      for (const scope of [
        ...(input.global === false ? [] : [{ kind: "global" as const }]),
        ...input.projects.map((p) => ({
          kind: "project" as const,
          project: p.id,
        })),
      ]) {
        resources.push(
          ...(await scanFiles(ctx, agent, scope, input.projects, warnings)),
        );
        const raw = await text(configPath(ctx, agent, scope, input.projects));
        if (raw === null) continue;
        try {
          for (const [name, nativeConfig] of Object.entries(
            servers(agent, raw),
          )) {
            let allowed;
            try {
              allowed = portableMcp(nativeConfig, agent);
            } catch (e) {
              warnings.push({
                name,
                path: configPath(ctx, agent, scope, input.projects),
                code:
                  (e as { code?: string }).code === "secret"
                    ? "excluded-secret"
                    : "review-required",
                message:
                  e instanceof Error
                    ? e.message
                    : "资源含未支持字段、凭据或格式，已排除；请在本机审查。",
              });
              continue;
            }
            const config = portableConfig(
              allowed,
              ctx,
              scope,
              input.projects,
            ) as Resource["config"];
            if (hasSecret(config)) {
              warnings.push({
                name,
                path: configPath(ctx, agent, scope, input.projects),
                code: "excluded-secret",
                message: "资源含凭据或疑似秘密，已排除；请改成凭据引用。",
              });
              continue;
            }
            const resource = checkedJson(
              {
                id: hash(agent + JSON.stringify(scope) + name).slice(0, 20),
                name,
                kind: "mcp",
                scope,
                sourceAgent: agent,
                provenance: {
                  adapterVersion: "0.1.0",
                  clientVersion: "unverified",
                  sourceHash: hash(raw),
                },
                config,
                dependencies: discoverDependencies(config),
                files: {},
                extensions: {},
              },
              resourceSchema.parse,
            );
            resources.push(resource);
          }
        } catch {
          warnings.push({
            code: "invalid-config",
            message: "配置解析失败，已跳过；请检查原生格式。",
          });
        }
      }
    }
    return { formatVersion: 1, resources, warnings };
  }
  const storage = new Storage(ctx);
  async function harness() {
    const raw = await storage.read("harness.json");
    const result = raw
      ? checkedJson(JSON.parse(raw), harnessSchema.parse)
      : { formatVersion: 1 as const, resources: [] };
    assertPortable(result);
    return result;
  }
  async function adopt(resources: Resource[]) {
    const selected = checkedJson(
      { formatVersion: 1, resources },
      harnessSchema.parse,
    );
    assertPortable(selected);
    await privateDirectory(ctx.state);
    return lock([join(ctx.state, "operation.lock")], async () => {
      const old = await harness();
      const map = new Map(old.resources.map((r) => [r.id, r]));
      for (const r of selected.resources) map.set(r.id, r);
      const next = {
        formatVersion: 1,
        resources: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
      };
      await storage.write("harness.json", next);
      return next;
    });
  }
  async function plan(input: PlanInput): Promise<Plan> {
    const source = await harness();
    const sourceHash = hash(canonical(source));
    const changes = new Map<string, Change>();
    const mcpOwners = new Map<string, { resource: string; value: string }>();
    const review: Plan["review"] = [];
    const conflicts: Plan["conflicts"] = [],
      warnings: Plan["warnings"] = [];
    for (const resource of source.resources.filter(
      (r) =>
        (input.global !== false || r.scope.kind !== "global") &&
        (!input.resources || input.resources.includes(r.id)),
    )) {
      for (const agent of input.agents) {
        if (resource.kind !== "mcp") {
          if (input.deletions?.includes(resource.id)) {
            warnings.push({
              code: "unsupported",
              resource: resource.id,
              message: "文件资源删除尚未实现；请手工确认清理。",
            });
            continue;
          }
          if (
            resource.kind === "instruction" &&
            resource.sourceAgent !== agent
          ) {
            warnings.push({
              code: "unsupported",
              resource: resource.id,
              message: "跨 agent 指令/规则格式需要人工确认，正文没有自动改写。",
            });
            continue;
          }
          const paths = nativePaths(ctx, agent, resource.scope, input.projects);
          for (const [name, content] of Object.entries(resource.files)) {
            const target = await checkPath(
              resource.kind === "skill"
                ? join(paths.skills, resource.name, portableFile(name))
                : paths.instruction,
            );
            const old = await text(target);
            if (old === content) continue;
            review.push({
              target,
              resource: resource.id,
              agent,
              before:
                old === null
                  ? null
                  : hasSecret(old)
                    ? "[本机内容含疑似秘密，值不展示]"
                    : old,
              after: content,
            });
            if (old !== null && !input.overwrite) {
              conflicts.push({
                code: "conflict",
                resource: resource.id,
                message: "目标资源已存在；请选择保留或明确覆盖。",
              });
              continue;
            }
            const previous = changes.get(target);
            if (previous && previous.content !== content) {
              conflicts.push({
                code: "duplicate-target",
                resource: resource.id,
                message: "多项来源写入同一目标，请选择唯一来源。",
              });
              continue;
            }
            changes.set(target, {
              target,
              beforeHash: hash(old ?? ""),
              afterHash: hash(content),
              content,
              resource: resource.id,
              agent,
              action: old === null ? "create" : "update",
            });
          }
          if (resource.sourceAgent !== agent)
            warnings.push({
              code: "extension-review",
              resource: resource.id,
              message:
                "技能正文原样保存；frontmatter、工具名称和权限需按目标 agent 审查。",
            });
          continue;
        }
        try {
          const target = await checkPath(
            configPath(ctx, agent, resource.scope, input.projects),
          );
          const existing = changes.get(target);
          const raw = existing?.content ?? (await text(target));
          const serverMap = servers(
            agent,
            raw ?? (agent === "codex" ? "" : "{}"),
          );
          const deleting = input.deletions?.includes(resource.id);
          if (resource.dependencies?.length)
            warnings.push({
              code: "dependency-review",
              resource: resource.id,
              message:
                "依赖声明：" +
                JSON.stringify(resource.dependencies) +
                "；应用配置不会安装或认证。请显式检查固定版本并绑定本机路径。",
            });
          const desired = deleting
            ? undefined
            : portableMcp(
                encodeMcp(mappedResource(resource, ctx, input.projects), agent),
                agent,
              );
          const value = deleting
            ? undefined
            : {
                ...localFields(serverMap[resource.name], agent),
                ...desired,
              };
          if (
            deleting &&
            serverMap[resource.name] &&
            canonical(serverMap[resource.name]) !==
              canonical(
                encodeMcp(mappedResource(resource, ctx, input.projects), agent),
              )
          ) {
            conflicts.push({
              code: "conflict",
              resource: resource.id,
              message: "删除目标与管理来源不同，请先显式导回并审查。",
            });
            continue;
          }

          if (
            !deleting &&
            serverMap[resource.name] &&
            canonical(serverMap[resource.name]) !== canonical(value) &&
            !input.overwrite
          ) {
            review.push({
              target,
              resource: resource.id,
              agent,
              before: reviewMcp(serverMap[resource.name], agent),
              after: reviewMcp(value, agent),
            });
            conflicts.push({
              code: "conflict",
              resource: resource.id,
              message: "同名原生资源与来源不同；明确选择覆盖或保留。",
            });
            continue;
          }
          const ownerKey = target + "\0" + resource.name;
          const owner = mcpOwners.get(ownerKey);
          if (
            owner &&
            owner.resource !== resource.id &&
            owner.value !== canonical(value)
          ) {
            conflicts.push({
              code: "duplicate-target",
              resource: resource.id,
              message: "多个来源产生同名目标 MCP；请选择唯一来源。",
            });
            continue;
          }
          mcpOwners.set(ownerKey, {
            resource: resource.id,
            value: canonical(value),
          });
          const updated = editServer(agent, raw ?? "", resource.name, value);
          if (updated === (raw ?? "")) continue;
          review.push({
            target,
            resource: resource.id,
            agent,
            before: reviewMcp(serverMap[resource.name], agent),
            after: reviewMcp(value, agent),
          });
          changes.set(target, {
            target,
            beforeHash: existing?.beforeHash ?? hash(raw ?? ""),
            afterHash: hash(updated),
            content: updated,
            resource: resource.id,
            agent,
            action: deleting ? "delete" : raw === null ? "create" : "update",
          });
        } catch (e) {
          conflicts.push({
            code: "unsupported-or-unmapped",
            resource: resource.id,
            message: e instanceof Error ? e.message : "无法适配。",
          });
        }
      }
    }
    if (
      [...changes.values()].reduce((n, c) => n + (c.content?.length ?? 0), 0) >
      16 * 1024 * 1024
    )
      fail("oversized", "计划变更内容超限，请分批选择。");
    const ordered = [...changes.values()].sort((a, b) =>
      a.target.localeCompare(b.target),
    );
    const id = hash(canonical({ sourceHash, changes: ordered }));
    await storage.write("plans/" + id + ".json", {
      formatVersion: 1,
      id,
      sourceHash,
      changes: ordered,
      conflicts,
      warnings,
    });
    return {
      id,
      sourceHash,
      changes: ordered.map(({ content, ...publicChange }) => publicChange),
      conflicts,
      warnings,
      review,
    };
  }
  async function apply(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail("invalid-input", "非法计划 ID。");
    const raw = await storage.read("plans/" + id + ".json");
    if (!raw) fail("not-found", "找不到计划。");
    const record = JSON.parse(raw) as {
      formatVersion: number;
      id: string;
      sourceHash: string;
      changes: Change[];
      conflicts: Plan["conflicts"];
    };
    if (
      record.formatVersion !== 1 ||
      record.id !== id ||
      hash(
        canonical({ sourceHash: record.sourceHash, changes: record.changes }),
      ) !== id
    )
      fail("invalid-state", "计划记录已损坏。");
    if (record.conflicts.length) fail("conflict", "请先解决计划中的冲突。");
    if (hash(canonical(await harness())) !== record.sourceHash)
      fail("drift", "管理来源发生变化，请重新计划。");
    return storage.transaction(record.changes, async () => {
      if (hash(canonical(await harness())) !== record.sourceHash)
        fail("drift", "管理来源发生变化。");
    });
  }
  async function nativeConfiguration(input: {
    agent: Agent;
    scope: Scope;
    projects: Project[];
  }) {
    return text(configPath(ctx, input.agent, input.scope, input.projects));
  }
  async function exportBundle(input: { path: string; resources: string[] }) {
    const source = await harness();
    return exportFile(input.path, {
      formatVersion: 1,
      resources: source.resources.filter((r) => input.resources.includes(r.id)),
    });
  }
  async function findResource(id: string) {
    const r = (await harness()).resources.find((r) => r.id === id);
    if (!r || r.kind !== "mcp") fail("not-found", "找不到 MCP 资源。");
    return r;
  }
  async function auth(id: string, agent: Agent) {
    return authGuidance(await findResource(id), agent);
  }
  async function verify(
    id: string,
    agent: Agent,
    approved: boolean,
    projects: Project[] = [],
  ) {
    const resource = await findResource(id);
    const raw = await nativeConfiguration({
      agent,
      scope: resource.scope,
      projects,
    });
    const expected = portableMcp(
      encodeMcp(mappedResource(resource, ctx, projects), agent),
      agent,
    );
    if (
      raw === null ||
      canonical(
        managedProjection(servers(agent, raw)[resource.name], agent),
      ) !== canonical(expected)
    )
      return {
        status: "配置未应用",
        method: "native-config-check",
        agent,
        mcp: resource.name,
        nextAction: "先预览并应用到该目标，再验证连接。",
      };
    return probe(
      checkedJson({ ...resource, config: expected }, resourceSchema.parse),
      agent,
      ctx,
      approved,
    );
  }
  async function check(input: {
    global?: boolean;
    agents: Agent[];
    resources: string[];
    projects: Project[];
  }) {
    const source = await harness();
    const selected = input.resources.map((id) => {
      const resource = source.resources.find((r) => r.id === id);
      if (!resource) fail("not-found", "找不到所选管理资源。");
      return resource;
    });
    const resources = [];
    for (const resource of selected.filter(
      (r) => input.global !== false || r.scope.kind !== "global",
    ))
      for (const agent of input.agents)
        resources.push(
          await checkResource(resource, agent, ctx, input.projects),
        );
    return {
      observedAt: new Date().toISOString(),
      method: "passive-local-check" as const,
      resources,
    };
  }
  return {
    check,
    scan,
    adopt,
    harness,
    plan,
    apply,
    exportBundle,
    importBundle: async (path: string) => {
      const result = await importBundle(path);
      assertPortable(result);
      return result;
    },
    auth,
    verify,
    installDependency: (input: {
      package: string;
      version: string;
      approved: boolean;
    }) => installDependency(ctx, input),
    history: () => storage.history(),
    locks: (id: string) => storage.locks(id),
    unlock: (id: string, nonces: string[], approved: boolean) =>
      storage.unlock(id, nonces, approved),
    recoveryCheck: (id: string) => storage.recoveryCheck(id),
    recover: (id: string) => storage.recover(id),
    nativeConfiguration,
  };
}
