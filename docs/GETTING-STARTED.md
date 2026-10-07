# Your first Shellter session

[English](GETTING-STARTED.md) · [简体中文](GETTING-STARTED.zh-CN.md) · [README](../README.md)

Start with the example. It creates files in a temporary HOME, so your actual Codex/Claude configurations stay untouched. No API key, native agent, or network MCP connection is needed. npm dependency installation needs network access or a populated cache.

## Open the demo

Install Node.js 24 and npm, download/extract the source repository, and open a terminal in the directory containing `package.json`. Then run:

```bash
node --version
npm --version
npm ci
npm run demo
```

Node should report `v24.x`. npm prints its version. Installation completes before the demo builds and starts. Open the one-use localhost URL printed in the terminal; keep the terminal running. A new demo run creates new example files and a new session URL.

If you downloaded a **prebuilt ZIP**, use `npm ci --omit=dev` instead of `npm ci`, then `npm run demo`. The package has already been built. Do not run source build commands inside the prebuilt package.

## Complete one operation

Choose **English** in the top-right **Language** selector if needed. The first session follows your browser language; your choice is remembered on this browser.

| Step | Click / select                                                                                                      | Expected result                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | In **Source agent**, leave **Codex CLI** and **Include global configuration** checked; click **Scan configuration** | Example `review-checklist` Skill and `example_docs` MCP appear                   |
| 2    | Check only **review-checklist**; inspect **Review selected content**, then click **Save selected resources**        | The Skill is marked **Saved**; no target file has changed                        |
| 3    | In **Target agent**, leave **Claude Code** selected                                                                 | Source and target are separate; no need to change the source                     |
| 4    | Click **Preview changes**                                                                                           | One file change, no conflict, and a cross-agent review warning                   |
| 5    | Read the target path, **Before**, **After**, and warnings; click **Apply reviewed changes**, then **Confirm**       | Configuration applied; local checklist appears; native loading stays unconfirmed |
| 6    | Click **Recover configuration**, then **Confirm**                                                                   | Configuration recovered                                                          |

Do not select `example_docs` for this walkthrough: its URL is intentionally non-live. The Skill's text is kept unchanged; the warning reminds you to check client-specific frontmatter/tool semantics before real use.

The operation ID is filled automatically after application. It identifies the write to recover. Stop the demo with **Ctrl+C** in the terminal; example artifacts remain in the printed temporary directory for inspection.

## Choose a task

The page starts with **Copy to another agent**. Choose **Move to a new machine** to scan/select/save resources and export a ZIP to an absolute path on this machine. Transfer that ZIP yourself. On the destination, choose **Use a configuration ZIP**, enter its local absolute path, inspect it, select/save resources, and preview before applying. Project resources require the same logical project IDs mapped to destination directories. Choose **Undo a configuration change** to view history and recover a specific operation.

## Check after applying

Application automatically runs **After migration: what is ready?** checks. Read the separate rows for target configuration, declared dependency versions, executable availability, environment references, native authentication, independent MCP probe, and native loading. **Matches saved resource** confirms the target files; **Native loading: Unconfirmed** remains until you check the native client yourself.

Use **Refresh local checks** after fixing local prerequisites. These checks only read files and the Shellter process environment, which may differ from the native client. They do not start programs or contact servers. For MCP, **Review connection probe** opens a separate confirmation because it can launch a program or connect to a server. A successful probe still does not prove native loading. The example MCP is non-live, so leave it unselected in the demo.

If an MCP probe reports **Authorization required** (HTTP 401), check native login or local credential binding. **Access denied** (HTTP 403) means the server refused access: verify the endpoint, account permissions and token scopes; repeating login alone may not help. A server/network failure is reported separately.

## What the words mean

- **Scan** reads selected native configurations without rewriting them.
- **Adopt** saves chosen resources as Shellter's managed source; it does not apply them to another client.
- **Plan** shows what would change and reports conflicts/warnings.
- **Apply** writes the approved configuration changes and records a local backup journal.
- **Recover** restores those writes if the target has not acquired new conflicting edits.

## Use your own configurations

Stop the example first. From a source checkout, run:

```bash
npm run build
npm start
```

From an installed prebuilt package, run `npm start` directly. This session uses your actual HOME. Starting it alone does not scan or modify anything.

1. Select only the source agent and scopes you intend to read. For a project, enter an existing path like `work=/absolute/project`, one mapping per line.
2. Scan, inspect the content, and select only the resources you want to manage. Click **Save selected resources**.
3. Choose the separate **Target agent**. For project migration, keep the same logical project ID and provide the destination directory.
4. Generate a plan. Resolve blocking conflicts and missing path mappings; read warnings and before/after values.
5. Approve only after reviewing the target files. Save the returned operation ID for recovery.
6. Confirm actual loading and authentication in the native client. Do not treat the file-write result as proof of either.

Keep backup journals private on the local machine. They can contain original credentials. For ZIP migration and explicit path-argument classification, use the [CLI guide](CLI.md). For the currently verified scope, use [compatibility](COMPATIBILITY.md).

## Use a custom Claude Code profile (such as tclaude)

First confirm the directory used by your installed client. In the local tclaude case, `tclaude auth status` reported `~/.tclaude`. Start Shellter with that directory:

```bash
node dist/cli.js --claude-config-dir "$HOME/.tclaude" serve
```

Choose **Codex CLI** as source and **Claude Code** as target. Check **Global locations** before scanning or applying: source Skills should be under `~/.agents/skills`, target Skills under `~/.tclaude/skills`, and target MCP under `~/.tclaude/.claude.json`. This option also accepts `CLAUDE_CONFIG_DIR`; the explicit option wins. It changes global Claude paths only. Keep using the same option for later CLI checks and planning. Do not point `--home` at `.tclaude`: that would also change where Shellter looks for Codex.

For a large library, use **Find resources** to search by name, type, client or project. Filtering preserves selected resources; **Select visible resources** adds the matches, while **Clear selection** clears all selections. Inspect the total selected count and review all selected content before saving. Without a search, **Select all available** selects the full list. Excluded resources are not selected. Each exclusion shows its name, location and reason. Expand individual files in the preview; repeated cross-client warnings are grouped. The post-migration checklist summarizes matching files and keeps problems expanded.

Restart tclaude, confirm the migrated Skills appear, and try a small request. Files matching, Skills appearing, and successful execution are separate results. A logged-in status alone is insufficient if a real request fails. Inspect `/mcp` separately for MCP connections; app-managed servers, tokens and OAuth sessions are not automatically portable. See the [real migration case](REAL-MIGRATION.md) for the verified scope and verification boundaries.

## Troubleshooting

| Problem                       | What to do                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `node` or `npm` not found     | Install Node 24, reopen the terminal, and check both versions                               |
| Cannot find package.json      | Change to the extracted project directory, not its parent or the ZIP file                   |
| npm install fails             | Check the first npm error, network access, proxy, and directory/cache permissions           |
| Invalid/used session entrance | Keep the server running and use the newest startup URL; restart for a fresh entrance        |
| No resources shown            | Scan Codex with global scope in the demo; the selected real scope may genuinely be empty    |
| Conflict or missing mapping   | Inspect the plan; choose a supported source/target and explicitly map paths before applying |
| Loading unconfirmed           | Confirm in the native client; configuration writes do not establish loading                 |
| Recovery blocked by drift     | Inspect later edits before recovery; do not force overwrite                                 |

Use the [detailed demo](DEMO.md) for screenshots, or `npm run demo:walkthrough` for an automatic configuration-only migration and rollback.


### Review and recover with confidence

Expand **Review selected content** to read each selected file with its original line breaks. MCP declarations remain structured JSON. If preview reports a conflict, read its proposed differences before deciding whether to allow overwrite and preview again.

After applying, **Inspect recovery conditions** shows the operation's targets and whether later edits block recovery. Save those later edits separately before inspecting the private backup journal or manually merging. Never share that journal: it may contain original credentials. Recovery checks again before writing.

In `npm run demo`, matching file checks followed by successful configuration recovery completes the example. Native-client loading is a separate check for a real migration, not a requirement for finishing the demo.
