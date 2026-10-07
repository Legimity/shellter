import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  type Context,
  type Scope,
  type Agent,
  type Project,
  type Resource,
  type Warning,
  resourceSchema,
} from "./model";
import { nativePaths } from "./adapters";
import { text, hash, hasSecret, portableFile, checkedJson } from "./security";
export async function scanFiles(
  ctx: Context,
  agent: Agent,
  scope: Scope,
  projects: Project[],
  warnings: Warning[],
) {
  const paths = nativePaths(ctx, agent, scope, projects),
    result: Resource[] = [];
  const skills = paths.skills;
  let names: string[] = [];
  try {
    names = await readdir(skills);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      warnings.push({ code: "unsafe-path", message: "技能目录不可安全读取。" });
  }
  for (const name of names.sort()) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name)) {
      warnings.push({
        name,
        path: join(skills, name),
        code: "unsupported",
        message: "技能名称不符合可移植格式。",
      });
      continue;
    }
    try {
      const files: Record<string, string> = {};
      let count = 0,
        total = 0;
      async function walk(directory: string, prefix = "") {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          if (++count > 128) throw new Error("技能文件数超过 128 项限制。");
          const rel = portableFile(prefix + item.name);
          if (item.isSymbolicLink())
            throw new Error("技能包含符号链接：" + rel);
          if (item.isDirectory())
            await walk(join(directory, item.name), rel + "/");
          else {
            const file = join(directory, item.name);
            const stat = await lstat(file);
            if (
              !stat.isFile() ||
              stat.size > 1024 * 1024 ||
              (total += stat.size) > 4 * 1024 * 1024
            )
              throw new Error("技能包含特殊文件或附件超过大小限制：" + rel);
            const content = await text(file);
            if (content === null || content.includes("\uFFFD"))
              throw new Error("技能文件不是受支持的文本：" + rel);
            if (hasSecret(content))
              throw new Error("技能文件含疑似秘密，请在本机审查：" + rel);
            files[rel] = content;
          }
        }
      }
      await walk(join(skills, name));
      if (!files["SKILL.md"]) continue;
      result.push(
        checkedJson(
          {
            id: hash(agent + JSON.stringify(scope) + "skill" + name).slice(
              0,
              20,
            ),
            name,
            kind: "skill",
            scope,
            sourceAgent: agent,
            config: {},
            files,
            extensions: {},
          },
          resourceSchema.parse,
        ),
      );
    } catch (e) {
      warnings.push({
        name,
        path: join(skills, name),
        code: "excluded-review",
        message: e instanceof Error ? e.message : "技能需审查后再扫描。",
      });
    }
  }
  const instruction = await text(paths.instruction);
  if (instruction && !hasSecret(instruction))
    result.push(
      checkedJson(
        {
          id: hash(agent + JSON.stringify(scope) + "instruction").slice(0, 20),
          name: "instructions",
          kind: "instruction",
          scope,
          sourceAgent: agent,
          config: {},
          files: { "instructions.md": instruction },
          extensions: {},
        },
        resourceSchema.parse,
      ),
    );
  return result;
}
