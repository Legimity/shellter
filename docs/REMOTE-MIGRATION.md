# A real macOS → Linux migration

[README](../README.md) · [Compatibility](COMPATIBILITY.md) · [Earlier local case](REAL-MIGRATION.md)

On 2026-10-07, Shellter exported an existing macOS Codex user Skills library and imported it on a separate Ubuntu 22.04.5 LTS x86_64 development machine over SSH. This is evidence for one machine and the versions below, not a general four-client compatibility guarantee.

## Environment and installation

- Shellter 0.1.0, pre-publication source snapshot (the CLI/core implementation is unchanged for the first public release).
- Source: macOS, 47 user Skills / 112 text files from Codex's user Skills location.
- Target: Ubuntu 22.04.5 LTS x86_64; system Node 22.19.0 remained unchanged. Node 24.21.0 was installed in a separate Shellter runtime directory.
- Native clients: tclaude 0.1.8 wrapping Claude Code 2.1.251, and CodeBuddy Code 2.154.0. The first tclaude status invocation automatically updated its wrapper from 0.1.6 to 0.1.8.
- The prebuilt ZIP installed production dependencies with `npm ci --omit=dev --ignore-scripts`. It still requires Node and a registry/cache; this was not a standalone-binary test or an untouched-machine test.
- Both the application ZIP and the exported Skills ZIP had matching SHA256 checksums before and after transfer.

The target used a custom tclaude profile. Its directory was explicitly passed to Shellter; the default Claude location was not assumed.

## Observed results

| Check | Result |
| --- | --- |
| Linux source validation | Typecheck, all 36 tests across 8 files, and production build passed |
| Extracted distribution | Isolated scan → export → import → apply → file verification → recovery walkthrough passed |
| Local web service | HTML and both JS/CSS assets served; unauthenticated API access rejected; authenticated session returned 47 saved resources and the correct custom profile |
| Real migration | Each target received 47 Skills / 112 files; 224 new files in total |
| Conflicts | Both reviewed plans were create-only, with no conflicts |
| Content verification | All 112 files on each target exactly matched source text |
| Repeat planning | Zero changes and zero conflicts for each target |
| Existing files | All 10 pre-existing files included in the settings/MCP/Skills baseline retained their hashes after validation |
| tclaude discovery | Native startup listed all 47 migrated Skills |
| Native model requests | Both tclaude and CodeBuddy returned the requested fixed marker successfully |
| Native Skill execution | Both clients invoked `Skill(codebase-design)` without a tool error and explained its Depth definition and deletion test |
| CodeBuddy discovery boundary | Its startup metadata did not enumerate the entire migrated Skills library. One native Skill invocation is verified; discovery of all 47 is not claimed |

Real Skills were retained on both clients. Separate Shellter operation journals record each application for explicit recovery. No real Skill operation was rolled back during this run; the isolated walkthrough and MCP fixture exercised recovery.

## A cross-machine MCP fixture

A separate, credential-free fixture was generated on the source machine and exported through Shellter. It contained a text Skill with a minimal stdio MCP script and an MCP declaration with an explicitly classified HOME-relative script argument.

On the target, Shellter imported the ZIP into an isolated temporary HOME, mapped the script path, and applied three file changes. The independent MCP probe connected successfully. Native tclaude then called only `mcp__shellter_probe__ping` and returned the expected fixed marker. Recovery removed the fixture configuration and script afterward.

This demonstrates that controlled cross-machine path, stdio transport and recovery flow. It does not demonstrate access to a real authenticated MCP service.

## Authentication and shell context

Initial noninteractive SSH probes did not inherit the authorization environment variables configured in the target's interactive shell. They entered login waiting or returned an authentication error. The underlying `tclaude auth status` also reported no native Claude login, which did not establish the wrapper's actual usability.

Running the same bounded probes through the target's normal interactive shell made both clients' fixed-response requests and Skill invocations succeed. No credential values were printed, copied from the source, or added to a configuration ZIP. Native MCP configuration was restricted to the explicit fixture, other built-in tools were disabled or limited to the selected Skill, hooks were disabled for these probes, and session persistence was disabled.

For future diagnosis, first check which shell/profile provides authentication and whether a real bounded request works. Do not infer that migration failed from an unrelated native login-status field, or assume a web/SSH process inherits an interactive terminal's environment.

## Remaining limits

- Four source MCP entries were excluded: two application-specific declarations and two declarations containing literal authentication headers. No real-service MCP credentials or login caches were migrated.
- Only one pure-text Skill was invoked on each client. Copying scripts or dependency-bearing Skills does not establish that their external tools are installed or their semantics are portable.
- CodeBuddy's existing user MCP file was named `mcp.json`; the current adapter's `.mcp.json` path still needs native version-specific validation. This run changed only its Skills, not its MCP configuration.
- Codex and Cursor native loading were not tested on the target. Windows, Linux ARM, other distributions and remote GitHub Actions remain unvalidated.
- Private operation IDs, machine addresses, startup output, configuration snapshots and journals stay in ignored case artifacts. They are not included in the published-source documentation or distribution assets.

The initial ad hoc source-validation tar included macOS AppleDouble metadata files, which were mistaken for tests on Linux. Those generated metadata files were removed before the clean 36-test run. The Shellter-generated application and configuration ZIPs did not contain those files.
