import { z } from "zod";
export const agents = ["codex", "claude", "codebuddy", "cursor"] as const;
export type Agent = (typeof agents)[number];
const safeName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("project"), project: safeName }),
]);
export type Scope = z.infer<typeof scopeSchema>;
export const resourceSchema = z
  .object({
    id: safeName,
    name: safeName,
    kind: z.enum(["mcp", "skill", "instruction"]),
    scope: scopeSchema,
    sourceAgent: z.enum(agents),
    provenance: z
      .object({
        adapterVersion: z.string(),
        clientVersion: z.string(),
        sourceHash: z.string().optional(),
      })
      .optional(),
    dependencies: z
      .array(
        z.object({
          package: z.string(),
          version: z.string(),
          source: z.literal("npm"),
        }),
      )
      .optional(),
    pathArguments: z.array(z.number().int().min(0).max(1024)).optional(),
    literalArguments: z.array(z.number().int().min(0).max(1024)).optional(),
    config: z.record(z.string(), z.json()).default({}),
    files: z.record(z.string(), z.string()).default({}),
    extensions: z.record(z.string(), z.json()).default({}),
  })
  .strict();
export type Resource = z.infer<typeof resourceSchema>;
export const harnessSchema = z
  .object({
    formatVersion: z.literal(1),
    resources: z.array(resourceSchema).max(1000),
  })
  .strict();
export type Harness = z.infer<typeof harnessSchema>;
export interface Project {
  id: string;
  path: string;
}
export interface Warning {
  code: string;
  resource?: string;
  name?: string;
  path?: string;
  message: string;
}
export interface Context {
  home: string;
  state: string;
  claudeConfigDir?: string;
}
export interface ScanInput {
  agents: Agent[];
  projects: Project[];
  global?: boolean;
}
export interface ScanResult extends Harness {
  warnings: Warning[];
}
export interface PlanInput {
  agents: Agent[];
  projects: Project[];
  resources?: string[];
  overwrite?: boolean;
  global?: boolean;
  deletions?: string[];
}
export interface Change {
  target: string;
  beforeHash: string;
  afterHash: string;
  content: string | null;
  resource: string;
  agent: Agent;
  action: "create" | "update" | "delete";
}
export interface Plan {
  review: {
    target: string;
    resource: string;
    agent: Agent;
    before: unknown;
    after: unknown;
  }[];
  id: string;
  sourceHash: string;
  changes: Omit<Change, "content">[];
  conflicts: Warning[];
  warnings: Warning[];
}
export class ShellterError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ShellterError";
  }
}
