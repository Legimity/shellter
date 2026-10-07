# A real Codex → tclaude migration

[First-run guide](GETTING-STARTED.md) · [中文指引](GETTING-STARTED.zh-CN.md) · [Compatibility](COMPATIBILITY.md)

On 2026-10-06, we tested an existing macOS installation: tclaude 0.1.8 wrapping Claude Code 2.1.251, with Node 24. This is a single-machine case, not a compatibility guarantee for other versions or platforms.

## What moved, and what was verified

| Check | Result |
| --- | --- |
| Actual profile | Native `tclaude auth status` identified `~/.tclaude`, rather than the default Claude directory |
| Scope | 47 user Skills, 112 text files, from `~/.agents/skills` to `~/.tclaude/skills` |
| Plan and application | Existing targets were absent; reviewed create-only changes were applied with local recovery journals |
| File verification | Every destination file matched its source; passive checks matched all 47 resources |
| Repeat planning | No further changes for the same selection |
| Native discovery | tclaude's startup event listed all 47 migrated Skills |
| Model request | Initial 2026-10-06 probe returned `Not logged in`; 2026-10-07 retry succeeded with exit code 0 and the requested fixed reply. The original cause is unresolved |
| Migrated Skill execution | On 2026-10-07, tclaude invoked the `codebase-design` Skill tool and correctly explained its Depth definition and deletion test |
| Native MCP execution | An isolated Codex MCP fixture was migrated to Claude format; tclaude invoked its local `ping` tool successfully, then Shellter recovered the fixture configuration |
| Recovery | Custom-directory apply/recovery passed in isolated tests; the user's real migrated Skills were retained |

The native probe used an empty temporary project, no session persistence, disabled tools and disabled MCP, and requested a fixed text reply. This first probe separates Skills discovery from authentication and prevents it from running migrated tools. The follow-up allowed only the Skill tool for one reviewed text-only Skill. A separate MCP test used only a local fixed-response endpoint and allowed only its harmless ping tool, with no real MCP credentials. It does **not** establish that every Skill's instructions, scripts, client-specific metadata or dependencies work in Claude Code.

No Codex model/provider settings were translated. The global Codex instruction file was empty. System/plugin-provided Skills were outside the user Skills scan. Two app-managed MCP declarations were excluded as non-portable, and two token-bearing HTTP MCP declarations awaited a choice of credential handling; none was claimed as connected. Credentials, raw startup output, native configuration backups and private journals are excluded from this repository and the distribution ZIP.

## Improvements prompted by the test

- A custom Claude directory option now follows scan, plan, apply, verification and recovery; the Web UI shows the actual global configuration locations.
- Bulk selection replaces dozens of repetitive selections. Exclusions identify the affected resource/file and reason.
- File diffs and repeated compatibility warnings can be expanded individually. Post-migration checks begin with counts, with file/prerequisite problems expanded.
- Empty shell arrays such as `WRITTEN_SECRET=()` no longer trigger the inline-secret heuristic. Nonempty assignments remain blocked; this recovered a valid template Skill.
- Global Codex instructions are read from `~/.codex/AGENTS.md`, separately from project `AGENTS.md`.
- The demo strips inherited `CLAUDE_CONFIG_DIR` so a real profile cannot redirect its fixture writes.

## What this teaches us about usability

[Kitter](https://github.com/what1f/kitter) emphasizes one Skills library, project installs and effective Skills visibility. That makes its entry task narrower and easy to explain. Shellter adds cross-client MCP/configuration planning and recovery, which creates more decisions. This test shows that the useful distinction is a visible sequence: **choose the real profile → inspect/select → preview → apply → check files → verify in the native client**. Shellter still needs better native-client discovery and clearer handling of excluded credential-bearing MCP entries; a successful write should never stand in for a successful client request. The follow-up now establishes one Skill invocation and one isolated native MCP call, while the two real credential-bearing services still require separate validation.

Reference paths and scope follow the [Codex Skills documentation](https://learn.chatgpt.com/docs/build-skills), [Claude settings documentation](https://code.claude.com/docs/en/settings), and [Claude MCP documentation](https://code.claude.com/docs/en/mcp). Wrapper profile behavior was checked on the installed client rather than inferred from its command name.

## Follow-up usability and failure checks (2026-10-07)

Resource search now matches name, type, client and project; selecting a filtered result preserves other selections and shows the total. HTTP 401 is reported as authorization required, HTTP 403 as access denied with a permission/scope check, and server errors as failures. Controlled endpoint responses are not copied into user-visible diagnostics. This case predates the public CI runs; see [GitHub Actions](https://github.com/Legimity/shellter/actions) for current validation.
