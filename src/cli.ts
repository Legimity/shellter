import { Command } from "commander";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCommands } from "./commands";
import { startServer } from "./server";
import { ShellterError } from "./model";
const program = new Command()
  .name("shellter")
  .version("0.1.0")
  .description("给你的 agents，一个能带走的家。")
  .option("--home <path>", "Explicit native configuration home", homedir())
  .option("--state <path>", "Private local state directory")
  .option(
    "--claude-config-dir <path>",
    "Claude Code custom directory (for example ~/.tclaude); overrides CLAUDE_CONFIG_DIR",
  );
function context() {
  const opts = program.opts();
  const home = realpathSync(resolve(opts.home));
  return {
    home,
    claudeConfigDir:
      opts.claudeConfigDir || process.env.CLAUDE_CONFIG_DIR
        ? resolve(opts.claudeConfigDir || process.env.CLAUDE_CONFIG_DIR)
        : undefined,
    state: opts.state
      ? resolve(opts.state)
      : join(home, ".local/state/shellter"),
  };
}
function parseProjects(values: string[] = []) {
  return values.map((value) => {
    const i = value.indexOf("=");
    if (i < 1)
      throw new ShellterError(
        "invalid-input",
        "项目映射格式为 id=/absolute/path。",
      );
    return {
      id: value.slice(0, i),
      path: realpathSync(resolve(value.slice(i + 1))),
    };
  });
}
const selected = (command: Command) =>
  command
    .option(
      "--agents <names>",
      "comma separated target/source agents",
      "codex,claude,codebuddy,cursor",
    )
    .option(
      "--project <id=path>",
      "explicit project mapping, repeatable",
      (v: string, p: string[]) => [...p, v],
      [],
    )
    .option("--no-global", "only project scope");
const selection = (o: Record<string, any>) => ({
  agents: o.agents.split(","),
  projects: parseProjects(o.project),
  global: o.global,
});
async function request(command: string, input: unknown) {
  const result = await createCommands(context()).execute(command, input);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
async function run(command: string, input: unknown) {
  await request(command, input);
}
selected(program.command("scan"))
  .option("--adopt", "explicitly adopt all safe scanned resources")
  .action(async (o) => {
    const result = (await request("scan", selection(o))) as {
      resources: unknown[];
    };
    if (o.adopt) await run("adopt", { resources: result.resources });
  });
selected(program.command("check"))
  .requiredOption(
    "--resources <ids>",
    "selected saved resources; read-only local checks",
  )
  .action((o) =>
    run("check", { ...selection(o), resources: o.resources.split(",") }),
  );
program.command("harness").action(() => run("harness", {}));
program
  .command("adopt")
  .requiredOption("--file <path>", "reviewed scan/harness JSON")
  .action(async (o) => {
    let data;
    try {
      data = JSON.parse(await readFile(o.file, "utf8"));
    } catch {
      throw new ShellterError("invalid-input", "输入文件不是合法 JSON。");
    }
    return run("adopt", { resources: data.resources });
  });
selected(program.command("plan"))
  .option("--resources <ids>", "only selected IDs")
  .option("--overwrite", "explicitly replace conflicting selected resources")
  .option(
    "--delete <ids>",
    "explicitly delete selected managed native resources",
  )
  .action((o) =>
    run("plan", {
      ...selection(o),
      resources: o.resources?.split(","),
      overwrite: !!o.overwrite,
      deletions: o.delete?.split(",") ?? [],
    }),
  );
program
  .command("apply <id>")
  .requiredOption("--approve", "approve the reviewed plan")
  .action((id, o) => run("apply", { id, approved: o.approve }));
program
  .command("export")
  .requiredOption("--output <path>")
  .requiredOption("--resources <ids>")
  .action((o) =>
    run("export", {
      path: resolve(o.output),
      resources: o.resources.split(","),
    }),
  );
program
  .command("import <path>")
  .option("--adopt", "explicitly adopt inspected resources")
  .action(async (path, o) => {
    const result = (await request("import", { path: resolve(path) })) as {
      resources: unknown[];
    };
    if (o.adopt) await run("adopt", { resources: result.resources });
  });
program
  .command("auth <id>")
  .requiredOption("--agent <name>")
  .action((id, o) => run("auth", { id, agent: o.agent }));
program
  .command("verify <id>")
  .requiredOption("--agent <name>")
  .requiredOption("--approve", "approve starting MCP/sending requests")
  .option(
    "--project <id=path>",
    "explicit project mapping",
    (v: string, p: string[]) => [...p, v],
    [],
  )
  .action((id, o) =>
    run("verify", {
      id,
      agent: o.agent,
      approved: o.approve,
      projects: parseProjects(o.project),
    }),
  );
program.command("history").action(() => run("history", {}));
program.command("locks <id>").action((id) => run("locks", { id }));
program
  .command("unlock <id>")
  .requiredOption(
    "--nonces <values>",
    "reviewed lock nonce list, comma separated",
  )
  .requiredOption("--approve")
  .action((id, o) =>
    run("unlock", { id, nonces: o.nonces.split(","), approved: o.approve }),
  );
program
  .command("recover <id>")
  .requiredOption("--approve")
  .action((id, o) => run("recover", { id, approved: o.approve }));
program
  .command("install")
  .requiredOption("--package <name>")
  .requiredOption("--package-version <version>")
  .requiredOption("--approve")
  .action((o) =>
    run("install", {
      package: o.package,
      version: o.packageVersion,
      approved: o.approve,
    }),
  );
program
  .command("recovery-check <id>")
  .description("Inspect recovery readiness without writing target files")
  .action(async (id) => run("recovery-check", { id }));
program
  .command("serve")
  .option("--demo", "Show isolated example guidance")
  .option("--port <number>", "loopback port", Number, 0)
  .action(async (o) => {
    const root = dirname(fileURLToPath(import.meta.url));
    const server = await startServer(context(), {
      port: o.port,
      demo: o.demo === true,
      webRoot: existsSync(join(root, "web/index.html"))
        ? join(root, "web")
        : join(root, "../dist/web"),
    });
    console.log("Shellter 本地界面：" + server.url);
    console.log(
      "链接包含本次会话的一次性入口，请只在本机浏览器打开。按 Ctrl+C 退出。",
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await server.close();
    };
    process.on("SIGINT", () => {
      void stop();
    });
    process.on("SIGTERM", () => {
      void stop();
    });
  });
try {
  await program.parseAsync();
} catch (e) {
  console.error(
    JSON.stringify({
      error: e instanceof ShellterError ? e.code : "operation-failed",
      message:
        e instanceof ShellterError
          ? e.message
          : "操作失败，请检查路径、配置或权限。",
    }),
  );
  process.exitCode = 1;
}
