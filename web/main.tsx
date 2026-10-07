import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Agent,
  Resource,
  Plan,
  Warning,
  Harness,
  ScanResult,
} from "../src/model";
import {
  bootstrapToken,
  initialLanguage,
  rememberLanguage,
  notice,
  type Language,
} from "./i18n";
import type { Storage } from "../src/storage";
import type { MigrationReport } from "../src/migration";
import "./style.css";
const agents: Agent[] = ["codex", "claude", "codebuddy", "cursor"];
const agentNames: Record<Agent, string> = {
  codex: "Codex CLI",
  claude: "Claude Code",
  codebuddy: "CodeBuddy Code CLI",
  cursor: "Cursor",
};
type Failure = { code: string; detail: string };
function projectMappings(value: string) {
  return value
    .split("\n")
    .filter((s) => s.trim())
    .map((s) => {
      const i = s.indexOf("=");
      if (i < 1 || !s.slice(i + 1).trim())
        throw new Error("work=/absolute/project/path");
      return { id: s.slice(0, i).trim(), path: s.slice(i + 1).trim() };
    });
}
function App() {
  const [language, setLanguage] = useState<Language>(() =>
    (() => {
      try {
        return initialLanguage(localStorage, navigator.languages);
      } catch {
        return initialLanguage(undefined, navigator.languages);
      }
    })(),
  );
  const t = (en: string, zh: string) => (language === "en" ? en : zh);
  const [locations, setLocations] = useState<Record<
    Agent,
    { config: string; skills: string; instruction: string }
  > | null>(null);
  const [historyItems, setHistoryItems] = useState<
    | {
        id: string;
        status: string;
        entries: { target: string; stage: string }[];
      }[]
    | null
  >(null);
  const [task, setTask] = useState<"copy" | "export" | "import" | "recover">(
    "copy",
  );
  const [demo, setDemo] = useState(false);
  const [recoveryReport, setRecoveryReport] = useState<Awaited<
    ReturnType<Storage["recoveryCheck"]>
  > | null>(null);
  const [checks, setChecks] = useState<MigrationReport | null>(null);
  const [checkSelection, setCheckSelection] = useState<{
    agents: Agent[];
    resources: string[];
    projects: { id: string; path: string }[];
    global: boolean;
  } | null>(null);
  const [probes, setProbes] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Failure | null>(null);
  const [result, setResult] = useState<unknown>(null),
    [lastCommand, setLastCommand] = useState("");
  const [sources, setSources] = useState<Agent[]>(["codex"]),
    [targets, setTargets] = useState<Agent[]>(["claude"]);
  const [global, setGlobal] = useState(true),
    [sourceProjects, setSourceProjects] = useState(""),
    [targetProjects, setTargetProjects] = useState("");
  const [resources, setResources] = useState<Resource[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [managed, setManaged] = useState<string[]>([]);
  const [resourceQuery, setResourceQuery] = useState("");
  const visibleResources = resources.filter((r) =>
    [
      r.name,
      r.kind,
      agentNames[r.sourceAgent],
      r.scope.kind === "global" ? "global 全局" : r.scope.project,
    ]
      .join(" ")
      .toLowerCase()
      .includes(resourceQuery.trim().toLowerCase()),
  );
  const [scanWarnings, setScanWarnings] = useState<Warning[]>([]),
    [loaded, setLoaded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null),
    [operation, setOperation] = useState("");
  useEffect(() => setRecoveryReport(null), [operation]);
  const [overwrite, setOverwrite] = useState(false),
    [deleting, setDeleting] = useState(false),
    [archive, setArchive] = useState("");
  const [edit, setEdit] = useState(""),
    [pkg, setPkg] = useState(""),
    [version, setVersion] = useState("");
  const [confirmation, setConfirmation] = useState<{
    name: string;
    input: Record<string, unknown>;
    en: string;
    zh: string;
  } | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    setChecks(null);
    setCheckSelection(null);
    setProbes({});
    if (lastCommand === "check" || lastCommand === "verify") {
      setLastCommand("");
      setResult(null);
    }
  }, [
    resources,
    ids,
    targets,
    targetProjects,
    global,
    sources,
    sourceProjects,
  ]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t(
      "Shellter · A portable home for your agents",
      "Shellter · 给 agents 一个能带走的家",
    );
    rememberLanguage(language);
  }, [language]);
  useEffect(() => {
    const token = bootstrapToken(location.hash);
    if (token) history.replaceState(null, "", location.pathname);
    void fetch(token ? "/api/session" : "/api/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: "{}",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("invalid-session");
        const data = await r.json();
        setLocations(data.environment?.locations ?? null);
        setDemo(data.environment?.demo === true);
        setConnected(true);
      })
      .catch(() => setError({ code: "invalid-session", detail: "" }));
  }, []);
  useEffect(() => {
    if (!confirmation) return;
    previousFocus.current = document.activeElement as HTMLElement;
    confirmButton.current?.focus();
    return () => previousFocus.current?.focus();
  }, [confirmation]);
  async function command<T = unknown>(
    name: string,
    input: unknown,
  ): Promise<T | null> {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: name, input }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError({
          code: data.error ?? "operation-failed",
          detail: data.message ?? "",
        });
        return null;
      }
      setResult(data.result);
      setLastCommand(name);
      return data.result as T;
    } catch (e) {
      setError({
        code: "operation-failed",
        detail: e instanceof Error ? e.message : "",
      });
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function invalidMapping() {
    setError({
      code: "invalid-input",
      detail: "Project mapping: work=/absolute/project/path",
    });
  }
  async function selectSource(name: "scan" | "harness" | "import") {
    try {
      const data = await command<ScanResult>(
        name,
        name === "scan"
          ? {
              agents: sources,
              projects: projectMappings(sourceProjects),
              global,
            }
          : name === "import"
            ? { path: archive }
            : {},
      );
      if (data) {
        setResources(data.resources);
        setResourceQuery("");
        setIds([]);
        setManaged(name === "harness" ? data.resources.map((r) => r.id) : []);
        setScanWarnings(data.warnings ?? []);
        setPlan(null);
        setEdit("");
        setLoaded(true);
      }
    } catch {
      invalidMapping();
    }
  }
  const selected = resources.filter((r) => ids.includes(r.id));
  const ready = ids.length > 0 && ids.every((id) => managed.includes(id));
  async function adopt(value: Resource[]) {
    const data = await command<Harness>("adopt", { resources: value });
    if (data) {
      setManaged(data.resources.map((r) => r.id));
      setResources((current) =>
        current.map(
          (r) => data.resources.find((saved) => saved.id === r.id) ?? r,
        ),
      );
      setPlan(null);
      setEdit("");
    }
  }
  async function makePlan() {
    setPlan(null);
    try {
      const data = await command<Plan>("plan", {
        agents: targets,
        projects: projectMappings(targetProjects),
        global,
        resources: ids,
        overwrite,
        deletions: deleting ? ids : [],
      });
      if (data) setPlan(data);
    } catch {
      invalidMapping();
    }
  }
  function approve(
    name: string,
    input: Record<string, unknown>,
    en: string,
    zh: string,
  ) {
    setConfirmation({ name, input, en, zh });
  }
  async function loadHistory() {
    const items = await command<NonNullable<typeof historyItems>>(
      "history",
      {},
    );
    if (items) setHistoryItems(items);
  }
  async function runChecks(selection: NonNullable<typeof checkSelection>) {
    setChecks(null);
    setProbes({});
    setCheckSelection(selection);
    const report = await command<MigrationReport>("check", selection);
    if (report) setChecks(report);
  }
  async function confirmAction() {
    if (!confirmation) return;
    const { name, input } = confirmation;
    setConfirmation(null);
    const data = await command<{ operation?: string; status?: string }>(name, {
      ...input,
      approved: true,
    });
    if (name === "apply" && data?.operation) {
      setOperation(data.operation);
      setPlan(null);
      await runChecks({
        agents: [...targets],
        resources: [...ids],
        projects: projectMappings(targetProjects),
        global,
      });
    }
    if (name === "verify" && data?.status)
      setProbes((current) => ({
        ...current,
        [String(input.id) + ":" + String(input.agent)]: data.status!,
      }));
    if (name === "recover" && data) {
      setHistoryItems(null);
      setRecoveryReport(null);
      setPlan(null);
      setChecks(null);
      setCheckSelection(null);
      setProbes({});
    }
  }
  const disabled = !connected || busy || !!confirmation;
  function agentPicker(value: Agent[], change: (a: Agent[]) => void) {
    return (
      <div className="agents">
        {agents.map((a) => (
          <label
            className={value.includes(a) ? "agent active" : "agent"}
            key={a}
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.includes(a)}
              onChange={() => {
                change(
                  value.includes(a)
                    ? value.filter((x) => x !== a)
                    : [...value, a],
                );
                setPlan(null);
              }}
            />
            {agentNames[a]}
          </label>
        ))}
      </div>
    );
  }
  function locationSummary(selectedAgents: Agent[]) {
    return (
      global &&
      locations && (
        <div className="location-summary">
          {selectedAgents.map((agent) => (
            <details key={agent} open={selectedAgents.length === 1}>
              <summary>
                {agentNames[agent]} · {t("Global locations", "全局配置位置")}
              </summary>
              <dl>
                <dt>MCP</dt>
                <dd>
                  <code>{locations[agent].config}</code>
                </dd>
                <dt>Skills</dt>
                <dd>
                  <code>{locations[agent].skills}</code>
                </dd>
                <dt>{t("Instructions", "指令")}</dt>
                <dd>
                  <code>{locations[agent].instruction}</code>
                </dd>
              </dl>
            </details>
          ))}
        </div>
      )
    );
  }
  function warnings(items: Warning[]) {
    const compatibility = items.filter((w) => w.code === "extension-review");
    const visible =
      compatibility.length > 1
        ? items.filter((w) => w.code !== "extension-review")
        : items;
    return (
      <>
        {" "}
        {compatibility.length > 1 && (
          <details className="notice-list">
            <summary>
              {t(
                "Review cross-client compatibility for ",
                "需审查跨客户端兼容性的资源：",
              )}
              {compatibility.length}
            </summary>
            <p>
              {notice("extension-review", language, compatibility[0].message)}
            </p>
            <ul>
              {compatibility.map((w, i) => (
                <li key={i}>
                  {resources.find((r) => r.id === w.resource)?.name ??
                    w.resource}
                </li>
              ))}
            </ul>
          </details>
        )}
        {visible.length > 0 && (
          <ul className="notice-list">
            {visible.map((w, i) => (
              <li key={i}>
                <strong>{w.code}</strong>
                {(w.name || w.resource) && (
                  <span>
                    {" "}
                    ·{" "}
                    {w.name ??
                      resources.find((r) => r.id === w.resource)?.name ??
                      w.resource}
                  </span>
                )}
                {w.path && (
                  <small>
                    <code>{w.path}</code>
                  </small>
                )}
                <p>{notice(w.code, language, w.message)}</p>
                {language === "en" && (
                  <details>
                    <summary>Original diagnostic</summary>
                    <pre>{w.message}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  const next =
    demo && lastCommand === "recover"
      ? t(
          "Demo complete: configuration was restored. You can stop the demo.",
          "示例完成：配置已回退，可以停止示例。",
        )
      : task === "recover"
        ? t(
            "View history, choose an operation ID and review recovery.",
            "查看操作记录，选择操作 ID，然后审查回退。",
          )
        : checks?.resources.some(
              (r) =>
                r.configuration !== "matched" ||
                r.dependencies.some((d) => d.status !== "satisfied") ||
                r.executable === "missing" ||
                r.executable === "binding-required" ||
                r.credentials.missing.length > 0,
            )
          ? t(
              demo
                ? "Resolve the file checklist items and refresh local checks; native loading is outside this demo."
                : "Resolve the checklist items, refresh local checks, then confirm native loading.",
              demo
                ? "先处理文件检查清单中的问题并刷新；原生加载不在本示例范围内。"
                : "先处理检查清单中的问题并刷新，再确认原生加载。",
            )
          : checks
            ? t(
                demo
                  ? "Example file checks complete. Try Recover configuration; no native client is required for this demo."
                  : "Read the checklist, then confirm loading in your native client.",
                demo
                  ? "示例文件检查完成。继续尝试回退配置；本示例不需要原生客户端。"
                  : "查看检查清单，然后在原生客户端确认加载。",
              )
            : task === "export" && ready
              ? t(
                  "Enter an absolute ZIP path below, export and transfer the file to the destination machine.",
                  "在下方输入 ZIP 绝对路径，导出后将文件传到目标机器。",
                )
              : task === "import" && !loaded
                ? t(
                    "Enter the ZIP path on this machine and inspect its contents.",
                    "输入本机上的 ZIP 路径，然后读取并审查内容。",
                  )
                : lastCommand === "apply" && operation && !plan
                  ? t(
                      demo
                        ? "Refresh local file checks, or recover this demo operation below."
                        : "Confirm native loading in the client, or recover this operation below.",
                      demo
                        ? "请刷新本地文件检查，或在下方回退本次示例操作。"
                        : "请在客户端确认原生加载，或在下方回退本次操作。",
                    )
                  : !loaded
                    ? t(
                        "Choose a source agent, then scan its configuration.",
                        "选择来源客户端，然后扫描配置。",
                      )
                    : !ids.length
                      ? t(
                          "Select resources and review their contents.",
                          "选择资源，并审查所选内容。",
                        )
                      : !ready
                        ? t(
                            "Save your selection before previewing target changes.",
                            "先保存所选资源，再预览目标变更。",
                          )
                        : !plan
                          ? t(
                              "Choose a target agent and preview the changes.",
                              "选择目标客户端，预览变更。",
                            )
                          : plan.conflicts.length
                            ? t(
                                "Resolve the conflicts, then generate a new preview.",
                                "处理冲突后，重新生成预览。",
                              )
                            : !plan.changes.length
                              ? t(
                                  "No files need changing. Review warnings before continuing.",
                                  "没有需要写入的变更，请查看提示。",
                                )
                              : t(
                                  "Review every file and warning before applying.",
                                  "应用前，请逐项审查文件和提示。",
                                );
  const outcomes: Record<string, [string, string]> = {
    "recovery-check": [
      "Read-only recovery inspection complete. Review the snapshot below.",
      "只读回退检查完成，请查看下方快照。",
    ],
    check: [
      demo
        ? "Demo file checks complete. Review the results, then try recovery."
        : "Local checks complete. Native authentication and loading still need confirmation.",
      demo
        ? "示例文件检查完成。查看结果，再尝试回退。"
        : "本地检查完成。原生授权与加载仍需确认。",
    ],
    scan: [
      "Scan complete. Select the resources you want to reuse.",
      "扫描完成，请选择需要复用的资源。",
    ],
    harness: [
      "Saved resources loaded. Select what to distribute.",
      "已读取保存的资源，请选择要分发的内容。",
    ],
    import: [
      "Package inspected. Review and save selected resources before applying.",
      "配置包已读取。请审查、保存所选资源，再应用。",
    ],
    adopt: [
      "Selection saved. Choose a target and preview changes.",
      "所选资源已保存。请选择目标并预览变更。",
    ],
    plan: [
      "Preview ready. Check files, conflicts and warnings below.",
      "预览已生成。请查看文件、冲突和提示。",
    ],
    apply: [
      demo
        ? "Demo configuration applied. Check the files, then try recovery."
        : "Configuration applied. Confirm loading and authentication in the native client.",
      demo
        ? "示例配置已应用，请检查文件，再尝试回退。"
        : "配置已应用。请在原生客户端确认加载和授权。",
    ],
    recover: [
      "Configuration recovered. External installations and authentication are unchanged.",
      "配置已回退。外部安装和认证保持原状。",
    ],
    export: [
      "Selected saved resources exported to the requested ZIP path.",
      "所选已保存资源已导出到指定 ZIP 路径。",
    ],
    auth: [
      "Native authentication guidance is available in the technical result. No login was performed.",
      "原生授权指引见技术结果。本次未执行登录。",
    ],
    verify: [
      "Probe finished. Check the technical result; this does not confirm native loading.",
      "探测结束，请检查技术结果；这不能证明原生加载。",
    ],
    history: [
      "Choose an operation below to review recovery.",
      "在下方选择操作记录，再审查回退。",
    ],
    locks: [
      "Lock inspection finished. Review owners in the technical result.",
      "锁检查完成，请在技术结果中查看拥有者。",
    ],
    unlock: [
      "Interrupted locks cleared. Recover configuration separately.",
      "中断锁已清理，请另行回退配置。",
    ],
    install: [
      "Dependency installation finished. Bind its local executable and recheck configuration.",
      "依赖安装完成，请绑定本机可执行路径后重新检查配置。",
    ],
  };
  function transferPanel() {
    return (
      <section className="panel" id="transfer" hidden={task === "recover"}>
        <details open={task === "export"} hidden={task !== "export"}>
          <summary className="section-summary">
            02 /{" "}
            {t(
              "Move configurations to another machine",
              "将配置迁移到另一台机器",
            )}
          </summary>
          <p className="hint">
            {t(
              "Export selected saved resources, transfer the ZIP yourself, then import on the destination. Import reads first; you still select, save and preview before applying.",
              "导出所选已保存资源，自行传输 ZIP，再在目标机器导入。导入仅先读取，仍需选择、保存和预览后再应用。",
            )}
          </p>
          <label className="field">
            {t("Absolute ZIP file path", "ZIP 文件绝对路径")}
            <input
              disabled={disabled}
              value={archive}
              onChange={(e) => setArchive(e.target.value)}
              placeholder="/absolute/shellter-harness.zip"
            />
          </label>
          <div className="actions">
            <button
              disabled={disabled || !archive || !ready}
              onClick={() =>
                void command("export", { path: archive, resources: ids })
              }
            >
              {t("Export selected resources", "导出所选资源")}
            </button>
          </div>
        </details>
        <details hidden={task === "export"}>
          <summary>
            {t(
              "Install a fixed npm dependency (advanced)",
              "安装固定 npm 依赖（高级）",
            )}
          </summary>
          <div className="grid">
            <label className="field">
              {t("Package name", "包名")}
              <input
                disabled={disabled}
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
              />
            </label>
            <label className="field">
              {t("Exact version", "固定版本")}
              <input
                disabled={disabled}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.2.3"
              />
            </label>
          </div>
          <p className="hint">
            {t(
              "Installs in Shellter's private local directory with install scripts disabled. Bind the executable locally and verify again. Configuration recovery does not uninstall dependencies.",
              "安装到 Shellter 本机私有目录，禁用安装脚本。请绑定本机可执行路径并重新验证，配置回退不会卸载依赖。",
            )}
          </p>
          <button
            disabled={disabled || !pkg || !version}
            onClick={() =>
              approve(
                "install",
                { package: pkg, version },
                `Install ${pkg}@${version}? Configuration recovery will not undo this installation.`,
                `安装 ${pkg}@${version}？配置回退不会撤销此安装。`,
              )
            }
          >
            {t("Review installation", "审查安装")}
          </button>
        </details>
      </section>
    );
  }
  return (
    <div className="layout">
      {confirmation && (
        <div className="confirmation-backdrop">
          <section
            className="confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirmation(null);
              if (e.key === "Tab") {
                const buttons =
                  e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="confirm-title">
              {t("Confirm this operation", "确认所选操作")}
            </h2>
            <p>{t(confirmation.en, confirmation.zh)}</p>
            <div className="actions">
              <button ref={confirmButton} onClick={() => void confirmAction()}>
                {t("Confirm", "确认执行")}
              </button>
              <button
                className="secondary"
                onClick={() => setConfirmation(null)}
              >
                {t("Cancel", "取消")}
              </button>
            </div>
          </section>
        </div>
      )}
      <aside>
        <a className="brand" href="/">
          ◒{" "}
          <span>
            Shellter
            <small>{t("LOCAL AGENT HOME", "本机 AGENT 配置之家")}</small>
          </span>
        </a>
        <div className="intro">
          {t(
            "A portable home for your agents.",
            "给你的 agents，一个能带走的家。",
          )}
        </div>
        <nav className="steps" aria-label={t("Workflow", "操作流程")}>
          <a href="#source" hidden={task === "recover"}>
            01 {t("Scan & select", "扫描与选择")}
          </a>
          <a href="#preview" hidden={task === "export" || task === "recover"}>
            02 {t("Preview changes", "预览变更")}
          </a>
          <a href="#recovery">03 {t("Results & checks", "结果与检查")}</a>
          <a href="#transfer" hidden={task !== "export"}>
            02 {t("Export ZIP", "导出 ZIP")}
          </a>
        </nav>
        <p className="side-note">
          {t(
            "Credentials stay with each native client. Review changes before applying.",
            "凭据留在各原生客户端。应用前请审查变更。",
          )}
        </p>
        <div className="session">
          ●{" "}
          {connected
            ? t("Local session connected", "本机会话已连接")
            : error?.code === "invalid-session"
              ? t("Local session unavailable", "本机会话不可用")
              : t("Connecting to local session", "正在连接本机会话")}
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">
              {t("YOUR PORTABLE WORKSPACE", "你的便携工作空间")}
            </span>
            <h1>
              {t("Bring your agent setup with you", "把熟悉的工作方式带走")}
            </h1>
            <p>
              {t(
                "Select Skills and MCP configurations. Preview before writing.",
                "选择 Skills 与 MCP 配置，先预览，再写入。",
              )}
            </p>
          </div>
          <div className="header-tools">
            <label className="language">
              <span>{t("Language", "语言")}</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                disabled={!!confirmation}
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </label>
            <span className="badge">v0.1.0</span>
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            <strong>{t("Action needs attention", "操作需要处理")}</strong>
            <p>{notice(error.code, language, error.detail)}</p>
            <small>{error.code}</small>
            {error.detail && (
              <details>
                <summary>{t("Diagnostic details", "诊断详情")}</summary>
                <pre>{error.detail}</pre>
              </details>
            )}
          </div>
        )}
        <section className="panel task-picker">
          <h2>{t("What would you like to do?", "你想完成什么任务？")}</h2>
          <div className="task-grid">
            {(
              [
                [
                  "copy",
                  "Copy to another agent",
                  "复制给另一个客户端",
                  "Scan → select → preview → apply → check",
                  "扫描 → 选择 → 预览 → 应用 → 检查",
                ],
                [
                  "export",
                  "Move to a new machine",
                  "迁移到新机器",
                  "Select → export ZIP → transfer yourself",
                  "选择 → 导出 ZIP → 自行传输",
                ],
                [
                  "import",
                  "Use a configuration ZIP",
                  "使用配置 ZIP",
                  "Inspect → select → preview → apply → check",
                  "读取 → 选择 → 预览 → 应用 → 检查",
                ],
                [
                  "recover",
                  "Undo a configuration change",
                  "回退配置变更",
                  "History → review → recover",
                  "记录 → 审查 → 回退",
                ],
              ] as const
            ).map(([id, en, zh, detailEn, detailZh]) => (
              <button
                key={id}
                className={"task-card " + (task === id ? "active" : "")}
                aria-pressed={task === id}
                disabled={disabled}
                onClick={() => {
                  if (task === id) return;
                  if (task === "import" || id === "import") {
                    setResources([]);
                    setIds([]);
                    setManaged([]);
                    setLoaded(false);
                    setScanWarnings([]);
                    setEdit("");
                  }
                  setTask(id);
                  if (id === "import") setGlobal(true);
                  setPlan(null);
                  setChecks(null);
                  setCheckSelection(null);
                  setProbes({});
                  setError(null);
                  setResult(null);
                  setLastCommand("");
                }}
              >
                <strong>{t(en, zh)}</strong>
                <small>{t(detailEn, detailZh)}</small>
              </button>
            ))}
          </div>
        </section>
        <div className="next-step" role="status">
          <strong>{t("Next step", "下一步")}</strong>
          <p>{busy ? t("Working… Please wait.", "正在执行，请稍候…") : next}</p>
        </div>
        <section className="panel" id="source" hidden={task === "recover"}>
          <div className="section-title">
            <h2>
              01 /{" "}
              {task === "import"
                ? t("Inspect & select resources", "读取与选择资源")
                : t("Scan & select resources", "扫描与选择资源")}
            </h2>
            <span>
              {t("Reads files; does not apply changes", "读取文件，不应用变更")}
            </span>
          </div>
          {task === "import" && (
            <div className="import-entry">
              <label className="field">
                {t("ZIP path on this machine", "本机 ZIP 文件路径")}
                <input
                  disabled={disabled}
                  value={archive}
                  placeholder="/absolute/shellter-harness.zip"
                  onChange={(e) => setArchive(e.target.value)}
                />
              </label>
              <p className="hint">
                {t(
                  "Inspection reads the package. Select and save resources before previewing destination files.",
                  "读取配置包后，选择并保存资源，再预览目标文件。",
                )}
              </p>
              <button
                disabled={disabled || !archive}
                onClick={() => void selectSource("import")}
              >
                {t("Inspect ZIP", "读取并审查 ZIP")}
              </button>
            </div>
          )}
          <div hidden={task === "import"}>
            <h3>{t("Source agent", "来源客户端")}</h3>
            {agentPicker(sources, setSources)}
            {locationSummary(sources)}
            <label className="field">
              <input
                type="checkbox"
                checked={global}
                disabled={disabled}
                onChange={(e) => {
                  setGlobal(e.target.checked);
                  setPlan(null);
                }}
              />
              {t("Include global configuration", "包含全局配置")}
            </label>
            <details>
              <summary>
                {t("Project configuration (optional)", "项目配置（可选）")}
              </summary>
              <label className="field">
                {t("Source project mappings", "来源项目映射")}
                <textarea
                  value={sourceProjects}
                  disabled={disabled}
                  placeholder="work=/absolute/project/path"
                  onChange={(e) => setSourceProjects(e.target.value)}
                />
                <small>
                  {t(
                    "One id=absolute-path per line. Directories must exist.",
                    "一行一个 id=绝对路径，目录必须存在。",
                  )}
                </small>
              </label>
            </details>
            <div className="actions">
              <button
                disabled={disabled || !sources.length}
                onClick={() => void selectSource("scan")}
              >
                {t("Scan configuration", "扫描原生配置")}
              </button>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void selectSource("harness")}
              >
                {t("Load saved resources", "读取已保存资源")}
              </button>
            </div>
          </div>
          {warnings(scanWarnings)}
          {!resources.length ? (
            <div className="empty">
              <span>◌</span>
              <h3>
                {loaded
                  ? t("No resources found", "未发现资源")
                  : task === "import"
                    ? t("Start by inspecting a ZIP", "从读取 ZIP 开始")
                    : t("Start with a scan", "从扫描开始")}
              </h3>
              <p>
                {loaded
                  ? t(
                      "Check the selected agent and scope, or import a configuration ZIP below.",
                      "检查所选客户端和作用域，或在下方导入配置包。",
                    )
                  : task === "import"
                    ? t(
                        "Enter a ZIP path above and inspect it before selecting resources.",
                        "在上方输入 ZIP 路径并读取，再选择资源。",
                      )
                    : t(
                        "Scanning does not install, log in, launch MCP programs or rewrite configurations.",
                        "扫描不会安装、登录、启动 MCP 或改写配置。",
                      )}
              </p>
            </div>
          ) : (
            <>
              <div className="section-title resource-heading">
                <h3>{t("Choose what to reuse", "选择要复用的资源")}</h3>
                <span>
                  {ids.length} / {resources.length} {t("selected", "已选择")}
                </span>
              </div>
              <label>
                {t("Find resources", "查找资源")}
                <input
                  type="search"
                  value={resourceQuery}
                  disabled={disabled}
                  placeholder={t(
                    "Name, type, agent or project",
                    "名称、类型、客户端或项目",
                  )}
                  onChange={(event) => setResourceQuery(event.target.value)}
                />
              </label>
              <p className="hint">
                {visibleResources.length} / {resources.length}{" "}
                {t(
                  "shown. Filtering keeps existing selections; review all selected resources before applying.",
                  "项显示。筛选会保留已有选择；应用前请审查全部所选资源。",
                )}
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={
                    disabled ||
                    !visibleResources.length ||
                    visibleResources.every((r) => ids.includes(r.id))
                  }
                  onClick={() => {
                    setIds([
                      ...new Set([
                        ...ids,
                        ...visibleResources.map((r) => r.id),
                      ]),
                    ]);
                    setPlan(null);
                    setEdit("");
                  }}
                >
                  {resourceQuery.trim()
                    ? t("Select visible resources", "选择筛选结果")
                    : t("Select all available", "选择全部可用资源")}
                </button>
                <button
                  className="secondary"
                  disabled={disabled || !ids.length}
                  onClick={() => {
                    setIds([]);
                    setPlan(null);
                    setEdit("");
                  }}
                >
                  {t("Clear selection", "清空选择")}
                </button>
                <span>
                  {t("Selected", "已选择")} {ids.length} / {resources.length}
                </span>
              </div>
              {!visibleResources.length && (
                <p role="status">
                  {t(
                    "No matching resources. Clear the search to see all resources.",
                    "没有匹配的资源，清空搜索可显示全部资源。",
                  )}
                </p>
              )}
              <div className="resource-list">
                {visibleResources.map((r) => (
                  <label className="resource" key={r.id}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={ids.includes(r.id)}
                      onChange={() => {
                        setIds(
                          ids.includes(r.id)
                            ? ids.filter((i) => i !== r.id)
                            : [...ids, r.id],
                        );
                        setPlan(null);
                        setEdit("");
                      }}
                    />
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {agentNames[r.sourceAgent]} ·{" "}
                        {r.scope.kind === "global"
                          ? t("Global", "全局")
                          : r.scope.project}{" "}
                        · {r.kind.toUpperCase()}
                      </small>
                    </div>
                    <span className="tag">
                      {managed.includes(r.id)
                        ? t("Saved", "已保存")
                        : t("Not saved", "未保存")}
                    </span>
                  </label>
                ))}
              </div>
              <details>
                <summary>
                  {t("Review selected content", "审查所选内容")}
                </summary>
                {selected.map((resource) => (
                  <article className="check-card" key={resource.id}>
                    <h3>
                      {resource.name} · {resource.kind}
                    </h3>
                    {resource.kind === "mcp" ? (
                      <pre>{JSON.stringify(resource.config, null, 2)}</pre>
                    ) : (
                      Object.entries(resource.files).map(([path, content]) => (
                        <details
                          key={path}
                          open={Object.keys(resource.files).length === 1}
                        >
                          <summary>{path}</summary>
                          <pre>{content}</pre>
                        </details>
                      ))
                    )}
                  </article>
                ))}
                <details>
                  <summary>
                    {t("Advanced: full resource JSON", "高级：完整资源 JSON")}
                  </summary>
                  <pre>{JSON.stringify(selected, null, 2)}</pre>
                </details>
              </details>
              <p className="hint">
                {t(
                  "Saving makes resources available to Shellter. It does not write to a target agent.",
                  "保存后，Shellter 才能使用这些资源；这一步不会写入目标客户端。",
                )}
              </p>
              <div className="actions">
                <button
                  disabled={disabled || !ids.length || ready}
                  onClick={() => void adopt(selected)}
                >
                  {ready
                    ? t("Selection saved", "所选资源已保存")
                    : t("Save selected resources", "保存所选资源")}
                </button>
                <button
                  className="secondary"
                  disabled={disabled || !ids.length}
                  onClick={() =>
                    setEdit(JSON.stringify({ resources: selected }, null, 2))
                  }
                >
                  {t("Edit selected JSON", "编辑所选 JSON")}
                </button>
              </div>
            </>
          )}
          {edit && (
            <div className="editor">
              <label className="field">
                {t("Selected resource JSON", "所选资源 JSON")}
                <textarea
                  value={edit}
                  disabled={disabled}
                  onChange={(e) => setEdit(e.target.value)}
                />
              </label>
              <div className="actions">
                <button
                  disabled={disabled}
                  onClick={() => {
                    try {
                      const value = JSON.parse(edit);
                      if (
                        !Array.isArray(value.resources) ||
                        JSON.stringify(
                          value.resources.map((r: Resource) => r.id).sort(),
                        ) !== JSON.stringify([...ids].sort())
                      )
                        throw new Error();
                      void adopt(value.resources);
                    } catch {
                      setError({
                        code: "invalid-input",
                        detail:
                          "Use a resources array and preserve the selected resource IDs.",
                      });
                    }
                  }}
                >
                  {t("Validate & save edits", "校验并保存编辑")}
                </button>
                <button className="secondary" onClick={() => setEdit("")}>
                  {t("Cancel editing", "取消编辑")}
                </button>
              </div>
              <small>
                {t(
                  "Use credential references. Actual secrets are rejected.",
                  "请使用凭据引用，实际秘密值会被拒绝。",
                )}
              </small>
            </div>
          )}
        </section>
        <section
          className="panel"
          id="preview"
          hidden={task === "export" || task === "recover"}
        >
          <div className="section-title">
            <h2>02 / {t("Preview target changes", "预览目标变更")}</h2>
            <span>
              {t("Nothing is written until you confirm", "确认前不会写入")}
            </span>
          </div>
          <h3>{t("Target agent", "目标客户端")}</h3>
          {agentPicker(targets, setTargets)}
          {locationSummary(targets)}
          <p className="hint">
            {t(
              task === "import"
                ? "Choose the destination client for this package."
                : "The target is independent of the source selected above.",
              task === "import"
                ? "选择使用此配置包的目标客户端。"
                : "目标与上方的来源分别选择。",
            )}
          </p>
          <details>
            <summary>
              {t(
                "Target project mappings & conflict options",
                "目标项目映射与冲突选项",
              )}
            </summary>
            <label className="field">
              {t("Destination projects", "目标项目")}
              <textarea
                disabled={disabled}
                value={targetProjects}
                placeholder="work=/absolute/destination/path"
                onChange={(e) => {
                  setTargetProjects(e.target.value);
                  setPlan(null);
                }}
              />
              <small>
                {t(
                  "Use the same logical project IDs as the source, with existing destination paths.",
                  "与来源使用相同项目 ID，路径填写已存在的目标目录。",
                )}
              </small>
            </label>
            <div className="choices">
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={overwrite}
                  onChange={(e) => {
                    setOverwrite(e.target.checked);
                    setPlan(null);
                  }}
                />
                {t(
                  "Overwrite conflicting selected resources",
                  "覆盖所选资源的同名冲突",
                )}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={deleting}
                  onChange={(e) => {
                    setDeleting(e.target.checked);
                    setPlan(null);
                  }}
                />
                {t("Delete selected MCP configurations", "删除所选 MCP 配置")}
              </label>
            </div>
          </details>
          <button
            disabled={disabled || !ready || !targets.length}
            onClick={() => void makePlan()}
          >
            {t("Preview changes", "预览变更")}
          </button>
          {!ready && (
            <p className="hint">
              {t(
                "Select and save resources in step 1 to enable preview.",
                "请在第 1 步选择并保存资源，之后才能预览。",
              )}
            </p>
          )}
          {plan && (
            <div className="plan">
              <div className="plan-counts">
                <strong>
                  {t("File changes:", "文件变更：")} {plan.changes.length}
                </strong>
                <span>
                  {t("Conflicts:", "冲突：")} {plan.conflicts.length}
                </span>
                <span>
                  {t("Warnings:", "提示：")} {plan.warnings.length}
                </span>
              </div>
              {warnings(plan.conflicts)}
              {plan.conflicts.length > 0 && (
                <p className="hint">
                  {t(
                    "Review the proposed differences below. Conflicts block application. Deselect conflicting resources to keep target content, or explicitly allow overwrite and preview again.",
                    "先查看下方拟议差异。存在冲突时无法应用。取消选择冲突资源可保留目标内容；如决定覆盖，请明确允许覆盖并重新预览。",
                  )}
                </p>
              )}
              {warnings(plan.warnings)}
              {plan.review.map((r, i) => (
                <details
                  className="file-review"
                  key={i}
                  open={plan.review.length === 1}
                >
                  <summary>
                    <h3>
                      {resources.find((x) => x.id === r.resource)?.name ??
                        r.resource}{" "}
                      · {agentNames[r.agent]}
                    </h3>
                    <code>{r.target}</code>
                  </summary>
                  <div className="grid">
                    <div>
                      <h4>{t("Before", "变更前")}</h4>
                      <pre>
                        {r.before === null
                          ? t("Not present", "不存在")
                          : typeof r.before === "string"
                            ? r.before.replace(
                                "[本机内容含疑似秘密，值不展示]",
                                t(
                                  "[Sensitive local content hidden]",
                                  "[本机内容含疑似秘密，值不展示]",
                                ),
                              )
                            : JSON.stringify(r.before, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4>{t("After", "变更后")}</h4>
                      <pre>
                        {r.after === null
                          ? t("Removed", "已删除")
                          : typeof r.after === "string"
                            ? r.after
                            : JSON.stringify(r.after, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              <details>
                <summary>{t("Technical plan JSON", "计划技术 JSON")}</summary>
                <pre>{JSON.stringify(plan, null, 2)}</pre>
              </details>
              <button
                disabled={
                  disabled || !!plan.conflicts.length || !plan.changes.length
                }
                onClick={() =>
                  approve(
                    "apply",
                    { id: plan.id },
                    "Apply this reviewed plan? Shellter will back up and modify the listed configuration files. It will not install dependencies or authorize a client.",
                    "确认应用已审查计划？Shellter 会备份并修改列出的配置文件，不会安装依赖或授权客户端。",
                  )
                }
              >
                {t("Apply reviewed changes", "应用已审查变更")}
              </button>
            </div>
          )}
        </section>
        {task === "export" && transferPanel()}
        <section className="panel" id="recovery">
          <div className="section-title">
            <h2>
              {task === "recover" ? "01" : "03"} /{" "}
              {t("Result & recovery", "结果与回退")}
            </h2>
            <span>
              {t(
                demo
                  ? "Demo: files and recovery"
                  : "Native loading needs a separate check",
                demo ? "示例：文件检查与回退" : "原生加载需另行确认",
              )}
            </span>
          </div>
          <div role="status" className="outcome">
            <p>
              {busy
                ? t("Working…", "正在执行…")
                : lastCommand && outcomes[lastCommand]
                  ? t(...outcomes[lastCommand])
                  : t(
                      "Your operation result will appear here.",
                      "操作结果将在这里显示。",
                    )}
            </p>
            {demo && (
              <p className="hint">
                {t(
                  "Demo mode verifies the file workflow. Native loading is outside this demo; matching files and successful recovery complete it.",
                  "示例模式验证文件流程，不要求原生加载；文件匹配并成功回退即完成示例。",
                )}
              </p>
            )}
            {operation && (
              <p>
                {t("Last application operation:", "最近应用操作：")}{" "}
                <code>{operation}</code>
              </p>
            )}
          </div>
          <details
            open={
              lastCommand === "auth" ||
              lastCommand === "verify" ||
              lastCommand === "locks"
            }
          >
            <summary>
              {t(
                "Technical result (original diagnostics)",
                "技术结果（原始诊断）",
              )}
            </summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
          {(task === "copy" || task === "import") && (
            <div className="migration-checks">
              <h3>
                {t("After migration: what is ready?", "迁移后：哪些已经就绪？")}
              </h3>
              <p className="hint">
                {t(
                  "Checks only read local files and the Shellter process environment; they do not start MCP or connect to a server. Native clients may use a different environment. Results are a snapshot.",
                  "检查仅读取本地文件与 Shellter 进程环境，不启动 MCP 或连接服务器。原生客户端可能使用不同环境；结果只是检查时的快照。",
                )}
              </p>
              <button
                className="secondary"
                disabled={
                  disabled || (!checkSelection && (!ready || !targets.length))
                }
                onClick={() => {
                  try {
                    void runChecks(
                      checkSelection ?? {
                        agents: [...targets],
                        resources: [...ids],
                        projects: projectMappings(targetProjects),
                        global,
                      },
                    );
                  } catch {
                    invalidMapping();
                  }
                }}
              >
                {t("Refresh local checks", "刷新本地检查")}
              </button>
              {checks && (
                <p className="hint">
                  {t("Checked at", "检查时间")} {checks.observedAt}
                  <br />
                  {
                    checks.resources.filter(
                      (r) => r.configuration === "matched",
                    ).length
                  }{" "}
                  / {checks.resources.length}{" "}
                  {t(
                    demo
                      ? "resources have matching files. Review details, then try recovery to finish the demo."
                      : "resources have matching files. Native loading still needs confirmation; expand a resource for details.",
                    demo
                      ? "项资源文件一致。查看详情，再尝试回退即可完成示例。"
                      : "项资源文件一致。原生加载仍待确认；展开资源查看检查详情。",
                  )}
                </p>
              )}
              {!checks && (
                <p>
                  {t(
                    "Apply a change to check automatically, or check selected saved resources now.",
                    "应用变更后自动检查，也可立即检查所选已保存资源。",
                  )}
                </p>
              )}
              {checks?.resources.map((r) => (
                <details
                  className="check-card"
                  key={r.resource + ":" + r.agent}
                  open={
                    checks.resources.length === 1 ||
                    r.configuration !== "matched" ||
                    r.credentials.missing.length > 0 ||
                    r.executable === "missing" ||
                    r.executable === "binding-required" ||
                    r.dependencies.some((d) => d.status !== "satisfied")
                  }
                >
                  <summary>
                    {r.name} · {agentNames[r.agent]} ·{" "}
                    {r.configuration === "matched"
                      ? t("Files match", "文件一致")
                      : t("Needs attention", "需要处理")}
                  </summary>
                  <dl>
                    <dt>{t("Target configuration", "目标配置")}</dt>
                    <dd
                      className={
                        r.configuration === "matched"
                          ? "check-ok"
                          : "check-pending"
                      }
                    >
                      {r.configuration === "matched"
                        ? t("Matches saved resource", "与保存资源一致")
                        : r.configuration === "missing"
                          ? t("Missing", "缺失")
                          : r.configuration === "different"
                            ? t(
                                "Different — review before applying",
                                "不一致，请先审查",
                              )
                            : t("Cannot check this mapping", "无法检查此映射")}
                      {r.issue && <> · {r.issue}</>}
                      <br />
                      {r.targets.join(" · ")}
                    </dd>
                    <dt>{t("Declared dependencies", "已声明依赖")}</dt>
                    <dd>
                      {r.dependencies.length
                        ? r.dependencies.map((d) => (
                            <div key={d.package}>
                              {d.package}@{d.version} ·{" "}
                              {d.status === "satisfied"
                                ? t("Version found locally", "本地找到所需版本")
                                : d.status === "mismatch"
                                  ? t("Version mismatch", "版本不符")
                                  : t(
                                      "Not found in checked locations",
                                      "检查目录内未找到",
                                    )}
                            </div>
                          ))
                        : t(
                            "None declared; this does not validate the whole runtime",
                            "未声明依赖，不能据此确认整个运行环境",
                          )}
                    </dd>
                    <dt>{t("Executable", "可执行程序")}</dt>
                    <dd>
                      {r.executable === "present"
                        ? t("Found; execution not tested", "已找到，未测试执行")
                        : r.executable === "missing"
                          ? t(
                              "Not found — install or fix its path",
                              "未找到，请安装或修正路径",
                            )
                          : r.executable === "binding-required"
                            ? t(
                                "npx needs an installed local dependency binding before probing",
                                "npx 需先安装并绑定本地依赖，才能探测",
                              )
                            : t("Not applicable", "不适用")}
                    </dd>
                    <dt>{t("Environment references", "环境变量引用")}</dt>
                    <dd>
                      {r.credentials.missing.length
                        ? t("Missing in Shellter: ", "Shellter 环境中缺少：") +
                          r.credentials.missing.join(", ")
                        : r.credentials.references.length
                          ? t(
                              "Present in Shellter; confirm in the native client: ",
                              "Shellter 中已存在，仍需在原生客户端确认：",
                            ) + r.credentials.references.join(", ")
                          : t(
                              "No environment references declared",
                              "未声明环境变量引用",
                            )}
                    </dd>
                    <dt>{t("Native authentication", "原生授权")}</dt>
                    <dd>
                      {demo
                        ? t("Outside this demo", "不在本示例范围内")
                        : r.authentication === "not-applicable"
                          ? t("Not applicable", "不适用")
                          : t(
                              "Confirm login / authorization in the native client",
                              "请在原生客户端确认登录或授权",
                            )}
                    </dd>
                    <dt>{t("Independent MCP probe", "独立 MCP 探测")}</dt>
                    <dd>
                      {r.kind !== "mcp"
                        ? t("Not applicable", "不适用")
                        : probes[r.resource + ":" + r.agent]
                          ? t(
                              (
                                {
                                  连接已验证: "Connection verified",
                                  待授权: "Authorization required",
                                  权限不足: "Access denied",
                                  依赖缺失: "Dependency missing",
                                  待配置依赖: "Dependency binding required",
                                  不支持: "Unsupported",
                                  失败: "Failed",
                                } as Record<string, string>
                              )[probes[r.resource + ":" + r.agent]] ??
                                "Probe needs attention",
                              probes[r.resource + ":" + r.agent],
                            )
                          : t("Not probed", "未探测")}
                    </dd>
                    <dt>{t("Native loading", "原生加载")}</dt>
                    <dd className="check-pending">
                      {t(
                        demo
                          ? "Outside this demo"
                          : "Unconfirmed — open the client and confirm this resource appears and works",
                        demo
                          ? "不在本示例范围内"
                          : "待确认：打开客户端，确认资源可见且能使用",
                      )}
                    </dd>
                  </dl>
                  <p className="hint" hidden={demo}>
                    {r.kind !== "mcp"
                      ? t(
                          "Reload the native client and confirm the skill or instruction is discovered.",
                          "重新加载原生客户端，确认发现了该 Skill 或指令。",
                        )
                      : r.agent === "claude"
                        ? t(
                            "Open Claude Code and inspect /mcp; complete any requested authentication.",
                            "打开 Claude Code，查看 /mcp，并完成提示的授权。",
                          )
                        : r.agent === "cursor"
                          ? t(
                              "Open Cursor MCP settings and confirm server status and authorization.",
                              "打开 Cursor 的 MCP 设置，确认服务器状态并完成授权。",
                            )
                          : t(
                              "Open the target client, inspect its MCP status and complete any requested native login.",
                              "打开目标客户端，检查 MCP 状态，并完成提示的原生登录。",
                            )}
                  </p>
                  {r.kind === "mcp" && (
                    <button
                      className="secondary"
                      disabled={disabled || r.configuration !== "matched"}
                      onClick={() =>
                        approve(
                          "verify",
                          {
                            id: r.resource,
                            agent: r.agent,
                            projects: checkSelection?.projects ?? [],
                          },
                          "Run an independent MCP probe? This can start the configured program or contact its server. It does not confirm native client loading.",
                          "执行独立 MCP 探测？这可能启动配置的程序或连接服务器，不能确认原生客户端加载。",
                        )
                      }
                    >
                      {t("Review connection probe", "审查连接探测")}
                    </button>
                  )}
                </details>
              ))}
            </div>
          )}
          <div hidden={task === "export"}>
            {historyItems && (
              <div>
                <h3>{t("Choose an operation", "选择操作记录")}</h3>
                {!historyItems.length && (
                  <p>{t("No recorded operations yet.", "还没有操作记录。")}</p>
                )}
                {historyItems.map((item) => (
                  <article className="check-card" key={item.id}>
                    <code>{item.id}</code>
                    <p>
                      {t(
                        (
                          {
                            applied: "Applied",
                            restored: "Recovered",
                            failed: "Failed",
                            applying: "Interrupted during application",
                            prepared: "Prepared",
                          } as Record<string, string>
                        )[item.status] ?? item.status,
                        (
                          {
                            applied: "已应用",
                            restored: "已回退",
                            failed: "失败",
                            applying: "应用中断",
                            prepared: "已准备",
                          } as Record<string, string>
                        )[item.status] ?? item.status,
                      )}
                    </p>
                    <ul>
                      {item.entries.map((entry) => (
                        <li key={entry.target}>{entry.target}</li>
                      ))}
                    </ul>
                    <button
                      className="secondary"
                      disabled={disabled || item.status === "restored"}
                      onClick={() => setOperation(item.id)}
                    >
                      {t("Select for recovery", "选择此记录以回退")}
                    </button>
                  </article>
                ))}
              </div>
            )}
            <label className="field">
              {t("Operation ID to recover", "要回退的操作 ID")}
              <input
                disabled={disabled}
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
                placeholder={t(
                  "Filled after applying; paste an earlier ID if needed",
                  "应用后自动填入，也可粘贴历史操作 ID",
                )}
              />
            </label>
            <div className="actions">
              <button
                className="secondary"
                disabled={disabled || !operation}
                onClick={() =>
                  approve(
                    "recover",
                    { id: operation },
                    "Recover this operation's configuration writes? Later conflicting edits will block recovery. Installations and authentication will not be undone.",
                    "确认回退此操作的配置写入？后续冲突修改会阻止回退，安装和认证不会撤销。",
                  )
                }
              >
                {t("Recover configuration", "回退配置")}
              </button>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void loadHistory()}
              >
                {t("View operation history", "查看操作记录")}
              </button>
            </div>
            <button
              className="secondary"
              disabled={disabled || !operation}
              onClick={async () => {
                const report = await command<
                  Awaited<ReturnType<Storage["recoveryCheck"]>>
                >("recovery-check", { id: operation });
                setRecoveryReport(report ?? null);
              }}
            >
              {t("Inspect recovery conditions", "检查回退条件")}
            </button>
            {recoveryReport && recoveryReport.operation === operation && (
              <article className="check-card">
                <h3>
                  {t("Recovery conditions (snapshot)", "回退条件（检查快照）")}
                </h3>
                <p>{recoveryReport.observedAt}</p>
                {recoveryReport.entries.map((entry) => (
                  <p key={entry.target}>
                    <strong>
                      {entry.state === "ready"
                        ? t("Ready to restore", "可回退")
                        : entry.state === "changed-after-recovery"
                          ? t(
                              "Edited after recovery; this operation will leave it unchanged",
                              "回退后又有编辑；本操作不会再修改此文件",
                            )
                          : entry.state === "changed"
                            ? t("Later edits detected", "检测到后续编辑")
                            : entry.state === "not-written"
                              ? t("Not written", "未写入")
                              : t("Already restored", "已回退")}
                    </strong>
                    <br />
                    <code>{entry.target}</code>
                  </p>
                ))}
                <p>
                  {t(
                    "Private backup journal (may contain credentials; do not share):",
                    "私有备份记录（可能含凭据，请勿分享）：",
                  )}{" "}
                  <code>{recoveryReport.privateJournal}</code>
                </p>
                <p>
                  {t(
                    "Keep a separate copy of later edits. Inspect entries.before in the private journal locally and merge manually if needed. Do not reset files merely to bypass protection. Recovery checks again before writing.",
                    "先单独保存后续编辑，再在本机查看私有记录的 entries.before，必要时手动合并。不要为了绕过保护而重置文件；回退执行前仍会重新检查。",
                  )}
                </p>
              </article>
            )}
            <details hidden={task === "recover"}>
              <summary>
                {t(
                  "MCP authentication & connection checks",
                  "MCP 授权与连接检查",
                )}
              </summary>
              <p className="hint">
                {t(
                  "Select one saved MCP and one target. A probe can launch its program or contact its server; this does not prove native loading.",
                  "选择一个已保存 MCP 和一个目标。探测可能启动程序或连接服务器，不能证明原生加载。",
                )}
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={
                    disabled ||
                    !ready ||
                    selected.length !== 1 ||
                    selected[0]?.kind !== "mcp" ||
                    targets.length !== 1
                  }
                  onClick={() =>
                    void command("auth", { id: ids[0], agent: targets[0] })
                  }
                >
                  {t("Native authentication guidance", "原生授权指引")}
                </button>
                <button
                  className="secondary"
                  disabled={
                    disabled ||
                    !ready ||
                    selected.length !== 1 ||
                    selected[0]?.kind !== "mcp" ||
                    targets.length !== 1
                  }
                  onClick={() => {
                    try {
                      approve(
                        "verify",
                        {
                          id: ids[0],
                          agent: targets[0],
                          projects: projectMappings(targetProjects),
                        },
                        "This probe may launch the configured MCP program or contact its server. It will not call models or business tools. Continue?",
                        "探测可能启动 MCP 程序或联系服务器，不会调用模型或业务工具。确认继续？",
                      );
                    } catch {
                      invalidMapping();
                    }
                  }}
                >
                  {t("Probe MCP connection", "探测 MCP 连接")}
                </button>
              </div>
            </details>
            <details>
              <summary>
                {t("Interrupted-operation lock recovery", "中断操作的锁恢复")}
              </summary>
              <p className="hint">
                {t(
                  "Use only for an interrupted operation. A running owner prevents lock cleanup. Recover configuration separately afterward.",
                  "仅用于中断操作。拥有者仍在运行时无法清理锁，之后需单独回退配置。",
                )}
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={disabled || !operation}
                  onClick={() => void command("locks", { id: operation })}
                >
                  {t("Inspect locks", "检查锁")}
                </button>
                <button
                  className="secondary"
                  disabled={disabled || !operation}
                  onClick={async () => {
                    const locks = await command<
                      { nonce: string; running: boolean }[]
                    >("locks", { id: operation });
                    if (locks?.length)
                      approve(
                        "unlock",
                        { id: operation, nonces: locks.map((l) => l.nonce) },
                        "Clear the inspected interrupted locks? Running owners or changed nonces block cleanup. Recover the configuration separately afterward.",
                        "清理已检查的中断锁？运行中的拥有者或变化的 nonce 会阻止清理，随后需单独回退配置。",
                      );
                  }}
                >
                  {t("Review lock cleanup", "审查锁清理")}
                </button>
              </div>
            </details>
          </div>
        </section>
        {task !== "export" && transferPanel()}
        <footer>
          {t(
            "Shellter · Credentials stay local. Take your configuration with you.",
            "Shellter · 凭据留在本机，配置带到下一台机器。",
          )}
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
