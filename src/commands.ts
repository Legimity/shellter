import { z } from "zod";
import { agents, resourceSchema, type Context } from "./model";
import { createApplication } from "./application";
import { checkedJson, fail } from "./security";
const agent = z.enum(agents),
  id = z.string().min(1).max(100),
  path = z.string().min(1).max(2048);
const projects = z
  .array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), path }))
  .max(50)
  .default([]);
const selection = z.object({
  agents: z.array(agent).min(1).max(4),
  projects,
  global: z.boolean().default(true),
});
export function createCommands(ctx: Context) {
  const app = createApplication(ctx);
  async function execute(command: string, input: unknown): Promise<unknown> {
    const parse = <T>(schema: z.ZodType<T>) =>
      checkedJson(input, schema.parse.bind(schema));
    switch (command) {
      case "check":
        return app.check(
          parse(selection.extend({ resources: z.array(id).min(1).max(1000) })),
        );
      case "scan":
        return app.scan(parse(selection));
      case "harness":
        return app.harness();
      case "adopt":
        return app.adopt(
          parse(z.object({ resources: z.array(resourceSchema).max(1000) }))
            .resources,
        );
      case "plan":
        return app.plan(
          parse(
            selection.extend({
              resources: z.array(id).max(1000).optional(),
              overwrite: z.boolean().default(false),
              deletions: z.array(id).max(1000).default([]),
            }),
          ),
        );
      case "apply":
        return app.apply(
          parse(
            z.object({
              id: z.string().regex(/^[a-f0-9]{64}$/),
              approved: z.literal(true),
            }),
          ).id,
        );
      case "export":
        return app.exportBundle(
          parse(z.object({ path, resources: z.array(id).max(1000) })),
        );
      case "import":
        return app.importBundle(parse(z.object({ path })).path);
      case "auth": {
        const p = parse(z.object({ id, agent }));
        return app.auth(p.id, p.agent);
      }
      case "verify": {
        const p = parse(
          z.object({ id, agent, projects, approved: z.literal(true) }),
        );
        return app.verify(p.id, p.agent, p.approved, p.projects);
      }
      case "recovery-check":
        return app.recoveryCheck(parse(z.object({ id })).id);
      case "history":
        return app.history();
      case "locks":
        return app.locks(
          parse(z.object({ id: z.string().regex(/^[a-f0-9-]{36}$/) })).id,
        );
      case "unlock": {
        const p = parse(
          z.object({
            id: z.string().regex(/^[a-f0-9-]{36}$/),
            nonces: z.array(z.string().regex(/^[a-f0-9-]{36}$/)).max(1000),
            approved: z.literal(true),
          }),
        );
        return app.unlock(p.id, p.nonces, p.approved);
      }
      case "recover": {
        const p = parse(
          z.object({
            id: z.string().regex(/^[a-f0-9-]{36}$/),
            approved: z.literal(true),
          }),
        );
        return app.recover(p.id);
      }
      case "install":
        return app.installDependency(
          parse(
            z.object({
              package: id,
              version: z.string().max(100),
              approved: z.literal(true),
            }),
          ),
        );
      default:
        fail("unsupported", "不支持该操作。");
    }
  }
  return { execute };
}
