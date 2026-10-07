import { join } from "node:path";
import type { Agent, Context, Project, Resource } from "./model";
import { configPath, encodeMcp, servers, nativePaths } from "./adapters";
import { mappedResource } from "./paths";
import { managedProjection, portableMcp } from "./policy";
import { canonical } from "./storage";
import { checkPath, portableFile, text } from "./security";
import { dependencyStatus } from "./dependencies";
import { executable } from "./verification";
export interface MigrationCheck {
  resource: string;
  name: string;
  agent: Agent;
  kind: Resource["kind"];
  configuration: "matched" | "missing" | "different" | "unsupported";
  targets: string[];
  dependencies: {
    package: string;
    version: string;
    status: "satisfied" | "missing" | "mismatch";
  }[];
  executable: "present" | "missing" | "binding-required" | "not-applicable";
  credentials: { references: string[]; missing: string[] };
  authentication: "native-confirmation-required" | "not-applicable";
  loading: "unconfirmed";
  issue?: string;
}
export interface MigrationReport {
  observedAt: string;
  method: "passive-local-check";
  resources: MigrationCheck[];
}
export async function checkResource(
  resource: Resource,
  agent: Agent,
  ctx: Context,
  projects: Project[],
): Promise<MigrationCheck> {
  const result: MigrationCheck = {
    resource: resource.id,
    name: resource.name,
    agent,
    kind: resource.kind,
    configuration: "unsupported",
    targets: [],
    dependencies: [],
    executable: "not-applicable",
    credentials: { references: [], missing: [] },
    authentication:
      resource.kind === "mcp"
        ? "native-confirmation-required"
        : "not-applicable",
    loading: "unconfirmed",
  };
  try {
    result.dependencies = (
      await dependencyStatus(ctx, resource.dependencies ?? [])
    ).map((d) => ({
      package: d.package,
      version: d.version,
      status:
        d.status === "版本满足"
          ? "satisfied"
          : d.status === "版本不满足"
            ? "mismatch"
            : "missing",
    }));
    if (resource.kind !== "mcp") {
      if (resource.kind === "instruction" && resource.sourceAgent !== agent)
        return result;
      const paths = nativePaths(ctx, agent, resource.scope, projects);
      const states = [];
      for (const [file, content] of Object.entries(resource.files)) {
        const target = await checkPath(
          resource.kind === "skill"
            ? join(paths.skills, resource.name, portableFile(file))
            : paths.instruction,
        );
        result.targets.push(target);
        const actual = await text(target);
        states.push(
          actual === null
            ? "missing"
            : actual === content
              ? "matched"
              : "different",
        );
      }
      result.configuration = !states.length
        ? "unsupported"
        : states.includes("different")
          ? "different"
          : states.includes("missing")
            ? "missing"
            : "matched";
      return result;
    }
    const config = portableMcp(
      encodeMcp(mappedResource(resource, ctx, projects), agent),
      agent,
    );
    const target = await checkPath(
      configPath(ctx, agent, resource.scope, projects),
    );
    result.targets.push(target);
    const raw = await text(target);
    result.configuration =
      raw === null
        ? "missing"
        : canonical(
              managedProjection(servers(agent, raw)[resource.name], agent),
            ) === canonical(config)
          ? "matched"
          : "different";
    result.executable =
      config.command === "npx"
        ? "binding-required"
        : typeof config.command === "string"
          ? (await executable(config.command))
            ? "present"
            : "missing"
          : "not-applicable";
    const references = new Set<string>();
    for (const field of [config.env, config.headers, config.http_headers]) {
      if (field && typeof field === "object" && !Array.isArray(field))
        for (const value of Object.values(field))
          if (typeof value === "string") {
            const match =
              /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Z_][A-Z0-9_]*)$/.exec(
                value,
              );
            if (match) references.add(match[1] ?? match[2]);
          }
    }
    if (typeof config.bearer_token_env_var === "string")
      references.add(config.bearer_token_env_var);
    if (
      config.env_http_headers &&
      typeof config.env_http_headers === "object" &&
      !Array.isArray(config.env_http_headers)
    )
      for (const value of Object.values(config.env_http_headers))
        if (typeof value === "string") references.add(value);
    result.credentials = {
      references: [...references].sort(),
      missing: [...references].filter((name) => !process.env[name]).sort(),
    };
    return result;
  } catch (e) {
    result.configuration = "unsupported";
    result.issue = (e as { code?: string }).code ?? "check-failed";
    return result;
  }
}
