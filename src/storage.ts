import { mkdir, rm, lstat, readdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { atomic, checkPath, text, fail, hash } from "./security";
import { type Context, type Change } from "./model";
export async function privateDirectory(path: string) {
  await checkPath(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if ((stat.mode & 0o077) !== 0)
    fail("unsafe-state", "状态目录权限必须为 0700。");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function lock<T>(
  paths: string[],
  action: () => Promise<T>,
): Promise<T> {
  const acquired: string[] = [];
  try {
    for (const path of [...new Set(paths)].sort()) {
      await checkPath(path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await checkPath(path);
      try {
        await mkdir(path, { mode: 0o700 });
        acquired.push(path);
        await atomic(
          join(path, "owner.json"),
          JSON.stringify({ pid: process.pid, nonce: crypto.randomUUID() }),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          fail("locked", "存在进行中或未恢复的操作锁；请先检查锁拥有者。");
        throw e;
      }
    }
    return await action();
  } finally {
    for (const p of acquired.reverse()) await rm(p, { recursive: true });
  }
}
export interface JournalEntry {
  target: string;
  before: string | null;
  beforeHash: string;
  afterHash: string;
  stage: "prepared" | "writing" | "applied" | "restored";
}
export interface Journal {
  formatVersion: 1;
  id: string;
  status: "prepared" | "applying" | "applied" | "failed" | "restored";
  entries: JournalEntry[];
}
export class Storage {
  constructor(readonly ctx: Context) {}
  async read(name: string) {
    return text(join(this.ctx.state, name), 64 * 1024 * 1024);
  }
  async write(name: string, value: unknown) {
    await privateDirectory(this.ctx.state);
    await atomic(join(this.ctx.state, name), JSON.stringify(value, null, 2));
  }
  async transaction(
    changes: Change[],
    validate: () => Promise<void> = async () => {},
  ) {
    await privateDirectory(this.ctx.state);
    return lock(
      [
        join(this.ctx.state, "operation.lock"),
        ...changes.map((c) => c.target + ".shellter-lock"),
      ],
      async () => {
        await validate();
        const entries: JournalEntry[] = [];
        for (const c of changes) {
          const before = await text(c.target);
          if (hash(before ?? "") !== c.beforeHash)
            fail("drift", "目标在预览后发生变化，请重新生成计划。");
          entries.push({
            target: c.target,
            before,
            beforeHash: c.beforeHash,
            afterHash: c.afterHash,
            stage: "prepared",
          });
        }
        const journal: Journal = {
          formatVersion: 1,
          id: crypto.randomUUID(),
          status: "prepared",
          entries,
        };
        const location = "journal/" + journal.id + ".json";
        await this.write(location, journal);
        try {
          journal.status = "applying";
          await this.write(location, journal);
          for (let i = 0; i < changes.length; i++) {
            const c = changes[i],
              entry = entries[i];
            if (hash((await text(c.target)) ?? "") !== entry.beforeHash)
              fail("drift", "目标写入前发生变化，请检查 journal。");
            entry.stage = "writing";
            await this.write(location, journal);
            if (c.content === null) await rm(c.target);
            else await atomic(c.target, c.content);
            if (hash((await text(c.target)) ?? "") !== c.afterHash)
              fail("write-failed", "写入复读不符合计划，请检查 journal。");
            entry.stage = "applied";
            await this.write(location, journal);
          }
          journal.status = "applied";
          await this.write(location, journal);
          return {
            operation: journal.id,
            status: "配置已应用",
            loading: "未能确认 agent 加载",
            nextAction: "通过原生客户端确认加载，按需授权并显式验证 MCP。",
          };
        } catch (e) {
          journal.status = "failed";
          await this.write(location, journal);
          throw e;
        }
      },
    );
  }
  async history() {
    await privateDirectory(this.ctx.state);
    const names = await readdir(join(this.ctx.state, "journal")).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    const result = [];
    for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const journal = await this.journal(name.slice(0, -5));
      result.push({
        id: journal.id,
        status: journal.status,
        entries: journal.entries.map(({ target, stage }) => ({
          target,
          stage,
        })),
      });
    }
    return result;
  }
  async journal(id: string): Promise<Journal> {
    if (!/^[a-f0-9-]{36}$/.test(id)) fail("invalid-input", "非法操作 ID。");
    const raw = await this.read("journal/" + id + ".json");
    if (!raw) fail("not-found", "找不到操作记录。");
    const journal = JSON.parse(raw) as Journal;
    if (
      journal.formatVersion !== 1 ||
      journal.id !== id ||
      !Array.isArray(journal.entries)
    )
      fail("invalid-state", "恢复记录格式非法。");
    return journal;
  }
  async locks(id: string) {
    const journal = await this.journal(id);
    const paths = [
      join(this.ctx.state, "operation.lock"),
      ...journal.entries.map((e) => e.target + ".shellter-lock"),
    ];
    const result = [];
    for (const path of [...new Set(paths)]) {
      const raw = await text(join(path, "owner.json"));
      if (!raw) {
        if (await lstat(path).catch(() => null))
          fail("invalid-lock", "锁拥有者记录不完整，请人工检查。");
        continue;
      }
      const owner = JSON.parse(raw) as { pid: number; nonce: string };
      if (
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1 ||
        !/^[a-f0-9-]{36}$/.test(owner.nonce)
      )
        fail("invalid-lock", "锁拥有者记录非法。");
      let running = true;
      try {
        process.kill(owner.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") running = false;
      }
      result.push({ path, ...owner, running });
    }
    return result;
  }
  async unlock(id: string, nonces: string[], approved: boolean) {
    if (!approved) fail("approval-required", "清理中断锁需要明确选择。");
    const locks = await this.locks(id);
    if (locks.some((o) => o.running))
      fail("locked", "拥有者进程仍存在，不能清理锁。");
    if (
      locks.length !== nonces.length ||
      locks.some((o) => !nonces.includes(o.nonce))
    )
      fail("drift", "锁拥有者已变化，请重新检查并明确确认 nonce。");
    for (const owner of locks) {
      const raw = await text(join(owner.path, "owner.json"));
      if (!raw || JSON.parse(raw).nonce !== owner.nonce)
        fail("drift", "锁拥有者已变化。");
      const quarantine = owner.path + ".recovery-" + crypto.randomUUID();
      await checkPath(quarantine);
      await rename(owner.path, quarantine);
      const captured = await text(join(quarantine, "owner.json"));
      if (!captured || JSON.parse(captured).nonce !== owner.nonce) {
        await rename(quarantine, owner.path);
        fail("drift", "锁拥有者已变化。");
      }
      await rm(quarantine, { recursive: true });
    }
    return {
      status: "中断锁已显式清理",
      nextAction: "检查 journal 后执行 recover；清锁本身不会回退配置。",
    };
  }
  private async readJournal(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) fail("invalid-input", "非法操作 ID。");
    await checkPath(this.ctx.state);
    const stat = await lstat(this.ctx.state).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT")
          fail(
            "not-found",
            "State directory not found; use the --state location of the original operation.",
          );
        throw error;
      },
    );
    if ((stat.mode & 0o077) !== 0)
      fail("unsafe-state", "状态目录权限必须为 0700。");
    const raw = await this.read("journal/" + id + ".json");
    if (!raw) fail("not-found", "找不到操作记录。");
    const journal = JSON.parse(raw) as Journal;
    if (
      journal.formatVersion !== 1 ||
      journal.id !== id ||
      !Array.isArray(journal.entries)
    )
      fail("invalid-state", "恢复记录格式非法。");
    return journal;
  }
  async recoveryCheck(id: string) {
    const journal = await this.readJournal(id);
    const entries = [];
    for (const entry of journal.entries) {
      const now = await text(entry.target);
      const digest = hash(now ?? "");
      entries.push({
        target: entry.target,
        state:
          entry.stage === "prepared"
            ? "not-written"
            : entry.stage === "restored"
              ? digest === entry.beforeHash
                ? "already-restored"
                : "changed-after-recovery"
              : digest === entry.beforeHash
                ? "already-restored"
                : digest === entry.afterHash
                  ? "ready"
                  : "changed",
        backupAvailable: entry.before !== null,
      });
    }
    return {
      operation: id,
      observedAt: new Date().toISOString(),
      privateJournal: join(this.ctx.state, "journal", id + ".json"),
      entries,
      nextAction:
        "Keep a separate copy of later edits. Inspect the private journal's entries.before locally; it may contain credentials. Merge manually when needed. Do not reset current files merely to bypass drift protection. This check is a snapshot; recovery rechecks before writing.",
    };
  }
  async recover(id: string) {
    const journal = await this.readJournal(id);
    return lock(
      [
        join(this.ctx.state, "operation.lock"),
        ...journal.entries.map((c) => c.target + ".shellter-lock"),
      ],
      async () => {
        for (const entry of journal.entries) {
          if (entry.stage === "prepared" || entry.stage === "restored")
            continue;
          const now = hash((await text(entry.target)) ?? "");
          if (now !== entry.afterHash && now !== entry.beforeHash)
            fail(
              "drift",
              `Recovery blocked by later edits: ${entry.target}. Keep a copy of current content, then run recovery-check ${id}. No files were restored.`,
            );
        }
        for (const entry of [...journal.entries].reverse()) {
          if (entry.stage === "prepared" || entry.stage === "restored")
            continue;
          const now = hash((await text(entry.target)) ?? "");
          if (now !== entry.afterHash && now !== entry.beforeHash)
            fail(
              "drift",
              `File changed during recovery: ${entry.target}. Stop and inspect recovery-check ${id} before retrying.`,
            );
          if (entry.before === null) await rm(entry.target, { force: true });
          else await atomic(entry.target, entry.before);
          entry.stage = "restored";
          await this.write("journal/" + id + ".json", journal);
        }
        journal.status = "restored";
        await this.write("journal/" + id + ".json", journal);
        return {
          status: "已回退配置",
          externalOperations: "依赖安装、原生认证和远程操作未撤销。",
        };
      },
    );
  }
}
