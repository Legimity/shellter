# Shellter CLI guide

[English README](../README.md) · [中文 README](../README.zh-CN.md)

Requires Node.js 24. See [compatibility](COMPATIBILITY.md) for bounded native Skill and model-call evidence on macOS/Linux; real-service MCP authentication and full client/platform coverage remain unvalidated. Commands print JSON results and errors. The Web UI and CLI use the same core.

## Choose your installation

From a source checkout:

```bash
npm ci
npm run build
node dist/cli.js --help
```

From the local prebuilt preview ZIP, extract it and enter its directory:

```bash
npm ci --omit=dev
node dist/cli.js --help
```

Download the prebuilt ZIP from [GitHub Releases](https://github.com/Legimity/shellter/releases/latest). It contains a built CLI and webpage; no build tool is needed. Node 24 and network/cache access for initial npm dependency installation are required.

The commands below use `node dist/cli.js` and work in either installation. In a source checkout, `npm run cli --` is an alternative for running the TypeScript source. Pass global options before the subcommand.

## First CLI session: try the example

After completing one installation above, run:

```bash
npm run demo:walkthrough
```

This automatically scans, selects, exports, imports, applies, and recovers one example Skill using temporary HOME directories. Expect five `PASS` lines and the temporary artifact directory. It does not touch your agent configurations or require an API key. The terminal prints where to inspect the example files.

The numbered steps below are for your own configurations. Finish scan and selection before planning: resource IDs come from the selected resources, plan IDs come from planning, and operation IDs come from application. Do not copy the uppercase placeholders literally.

## Global options and scope

| Option                   | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `--home /absolute/home`  | Existing native configuration HOME; defaults to your actual HOME |
| `--claude-config-dir /absolute/profile` | Global Claude directory (e.g. `$HOME/.tclaude`); overrides `CLAUDE_CONFIG_DIR` |
| `--state /private/state` | Shellter state; defaults to HOME/.local/state/shellter           |
| `--version`, `--help`    | CLI version/help                                                 |

For tclaude, first confirm its active configuration directory (for example with `tclaude auth status`). Use `node dist/cli.js --claude-config-dir "$HOME/.tclaude" serve` for the Web UI, and keep this global option for subsequent CLI scan/plan/check commands. This changes Claude global MCP, Skills and instructions paths; project paths and Codex paths stay scoped to their own locations. The isolated demo ignores `CLAUDE_CONFIG_DIR`.

Scan/plan scope options follow their subcommand:

| Option                             | Meaning                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `--agents codex,claude`            | Source or target agents for scan/plan; defaults to all four                      |
| `--project work=/absolute/project` | Existing project directory mapped to logical ID; repeatable for scan/plan/verify |
| `--no-global`                      | Scan/plan only explicitly mapped projects                                        |

Agent values: `codex`, `claude`, `codebuddy`, `cursor`. State directories must be private (0700). Backup journals can contain original credentials and must stay local, outside Git and transfer packages. CLI help for a specific command: `node dist/cli.js plan --help`.

## 1. Scan and adopt selected resources

```bash
node dist/cli.js scan --agents codex > scan.json
```

Review the result. Save a separate `selected.json` with a top-level `resources` array containing only the entries you want to manage; preserve IDs and scope. Do not put real credentials into this file.

```bash
node dist/cli.js adopt --file selected.json
node dist/cli.js harness
```

Project-only scanning:

```bash
node dist/cli.js scan --agents codex --project work=/absolute/project --no-global
```

`scan --adopt` explicitly adopts all safe scanned entries and prints both scan and adoption results. Do not use it when you want selection. Unknown MCP fields are excluded; environment values must be references. Cross-client permission mappings without supported semantics block planning.

## 2. Review and apply

Replace `RESOURCE_ID` and `PLAN_ID` with actual output; they are placeholders, not literal arguments:

```bash
node dist/cli.js plan --agents claude --resources RESOURCE_ID
node dist/cli.js apply PLAN_ID --approve
```

Check `changes`, `review` before/after values, `conflicts`, and `warnings`. Conflicts block application. `--overwrite` is an explicit choice to replace conflicting managed fields; unknown native fields remain machine-local. Replan if either managed source or target files changed. Application prints an `operation` ID for recovery and reports native loading as unconfirmed.

For project resources, pass the same logical project ID with the destination's existing path to plan. Example:

```bash
node dist/cli.js plan --agents claude --resources RESOURCE_ID --project work=/new/project --no-global
```

Absolute executable paths under HOME/project can be normalized. Absolute launch arguments require explicit classification in the reviewed resource JSON: change a path to `${SHELLTER_HOME}/server.js` or `${SHELLTER_PROJECT}/server.js` and set `pathArguments: [0]` for its zero-based index; use `literalArguments: [0]` only for intentional literal data. Adopt the reviewed edit and replan. Shellter does not guess arbitrary argument meanings.

## Read-only checks after migration

```bash
node dist/cli.js check --agents claude --resources RESOURCE_ID
```

Add `--project work=/destination/project` for project resources, or `--no-global` to exclude global resources. This command only reads local configuration files, declared fixed dependency versions, executable availability, and environment reference names. It does not launch MCP or contact servers, and it never returns environment values. Each resource reports `configuration`, `dependencies`, `executable`, `credentials`, `authentication`, and `loading`, with an observation timestamp. Dependency lookup covers the same local locations as installation checks; it is not a complete runtime validation. Environment references are checked against the Shellter process, which may differ from your native client's environment. Native loading remains `unconfirmed`; complete login and resource discovery in that client separately. Refresh after installing dependencies or editing configuration.

## 3. Export and migrate

```bash
node dist/cli.js export --output /absolute/harness.zip --resources RESOURCE_ID
```

Export refuses to overwrite an existing file. Transfer the ZIP using your preferred method. On the destination machine, inspect first:

```bash
node dist/cli.js import /absolute/harness.zip > imported.json
```

Review/select resources, then `adopt --file selected.json`, map destination projects, and plan/apply. `import /absolute/harness.zip --adopt` explicitly adopts all inspected entries and prints two consecutive JSON documents; use separate import/adopt commands for a single machine-readable result per invocation. Imported resources are not executed automatically.

## 4. Authentication and verification

```bash
node dist/cli.js auth RESOURCE_ID --agent claude
node dist/cli.js verify RESOURCE_ID --agent claude --approve
```

Add `--project work=/destination/project` for project resources. `auth` provides native-client guidance, not an automated login or token transfer. `verify` may launch the configured MCP program or send requests. It initializes and may list capabilities, without calling business tools or models. An independent probe does not prove native-client loading or OAuth state. Resolve missing local credential references using the native/client environment, never by adding tokens to managed JSON.

Fixed npm dependencies can be explicitly installed:

```bash
node dist/cli.js install --package package-name --package-version 1.2.3 --approve
```

Replace these example values with a reviewed actual dependency. Installation uses `--ignore-scripts`; bind the installed executable in local command/args and replan. Verification never automatically downloads an npx package. Dependency installation is not undone by configuration recovery.

## 5. Recover and inspect interrupted operations

```bash
node dist/cli.js history
node dist/cli.js recovery-check OPERATION_ID
node dist/cli.js recover OPERATION_ID --approve
```

Recovery checks target hashes and refuses new drift. If a killed writer left locks:

```bash
node dist/cli.js locks OPERATION_ID
node dist/cli.js unlock OPERATION_ID --nonces NONCE1,NONCE2 --approve
node dist/cli.js recover OPERATION_ID --approve
```

Use the exact nonce list returned by `locks`. A still-running owner or changed nonce blocks cleanup. Missing PID alone never triggers automatic unlock. Recovery affects configuration writes only, not installations, authentication, or remote actions.

## Other commands

| Command                     | Behavior                                                                   |
| --------------------------- | -------------------------------------------------------------------------- |
| `serve --port 0`            | Start the loopback UI, print a one-use session URL; Ctrl+C stops it        |
| `plan --delete RESOURCE_ID` | Preview deletion of the selected MCP; files/Skills deletion is unsupported |
| `harness`                   | Read current managed source without changing native files                  |

All commands accept `--help`. JSON output can include Chinese status text. Treat result codes, paths, conflicts, and method/limitation fields as evidence rather than assuming a write means the native agent loaded it.

## Example-only walkthrough

From source: `npm run demo` for the UI or `npm run demo:walkthrough` for automatic ZIP migration and recovery. From the prebuilt ZIP: `npm run demo` or `npm run demo:walkthrough` without rebuilding. These use temporary fixture HOME directories, leave artifacts available for inspection, and do not run a native agent, OAuth, MCP, or model.

## Troubleshooting

| Result                                | Action                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `conflict` / unsupported mapping      | Review warnings/permissions/path classifications; choose a supported target or edit the managed source |
| `drift`                               | Rescan/review and regenerate the plan; do not reuse stale approvals                                    |
| `secret` / `review-required`          | Remove sensitive values or unsupported fields; use supported credential references                     |
| `locked`                              | Inspect owner and journal; explicitly recover interrupted locks as described above                     |
| Dependency missing/version mismatch   | Install and bind the declared fixed version locally, then replan                                       |
| Configuration applied/loading unknown | Confirm loading and authorization in the actual native client                                          |


### Reviewing conflicts and blocked recovery

A conflicting plan includes proposed `review` differences even when overwrite is disabled. It still cannot be applied. Review these first; deselect the conflicting resource to preserve the target, or explicitly enable `--overwrite` and generate a new plan. Resource ID lists are comma-separated; copy the IDs from scan output rather than deriving them from resource names.

`recovery-check OPERATION_ID` only reads local files. Use the same `--state` directory as the original apply. It reports each target as `ready`, `changed`, `already-restored`, `changed-after-recovery` (later edits that this completed operation will leave untouched), or `not-written`, and gives the private journal path without returning its contents. This is a snapshot; `recover` checks again before writing.

If a target is `changed`, keep a separate copy of its current contents first. Open the private journal locally: `entries[].before` is the original text (`null` means the file did not exist). Compare it with the current file in your editor and merge manually if needed, or retain the current file and leave recovery blocked. The journal can contain original credentials: do not upload it or paste it into an issue. Do not reset current content merely to bypass drift protection.

### Symbolic-link paths

Shellter rejects symbolic links in managed paths. An `unsafe-path` error identifies the blocked link and, when resolvable, a real-path candidate. Inspect that location and explicitly use its real absolute path if it is the intended destination. On macOS, `/tmp` commonly resolves to `/private/tmp`; use the inspected real path consistently for scan, state, export and import. Shellter never automatically accepts a candidate or disables this check.
