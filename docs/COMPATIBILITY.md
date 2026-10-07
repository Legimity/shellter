# Compatibility and limitations

[README](../README.md) · [First-run guide](GETTING-STARTED.md)

Shellter 0.1.0 provides the configuration coverage below. Configuration-file coverage and native-client compatibility are separate checks.

| Target             | Current configuration coverage                                             | Native loading / OAuth |
| ------------------ | -------------------------------------------------------------------------- | ---------------------- |
| Codex CLI          | TOML MCP configuration, text Skills, same-client instructions              | Not yet validated      |
| Claude Code        | JSON/JSONC MCP configuration, text Skills, same-client instructions        | tclaude: 47 Skills discovered and one invoked on macOS/Linux; isolated HTTP (macOS) and stdio (Linux) MCP calls passed; real-service auth pending |
| CodeBuddy Code CLI | MCP fixtures; user MCP path needs version confirmation; real text Skills migration | One migrated Skill invoked on Linux with 2.154.0; full discovery and native MCP remain unvalidated |
| Cursor editor      | MCP configuration and text resource fixtures                               | Not yet validated      |

Automated tests use isolated files and a controlled MCP endpoint. The demo verifies a Codex Skill fixture moving to a Claude configuration location, including ZIP migration to a different HOME and recovery. These results do not establish native-client loading or authentication.

A [real macOS case](REAL-MIGRATION.md) migrated 47 user Skills (112 files) from Codex to a custom tclaude directory. Native startup listed all migrated Skills. A follow-up fixed-response model request and one migrated Skill invocation succeeded. A local MCP fixture was migrated, invoked by native tclaude and recovered. Real-service MCP credential migration was not completed. These checks do not validate every Skill’s semantics or execution.

## Platforms and installation

Checks passed on macOS and one Ubuntu 22.04.5 LTS x86_64 development machine with Node 24.21.0. The [cross-machine case](REMOTE-MIGRATION.md) covers 36 tests, typecheck/build, extracted-package migration/recovery, local web endpoints, and bounded native tclaude/CodeBuddy calls. Other Linux environments, Windows and remote GitHub Actions remain unvalidated. Source and prebuilt packages require Node.js 24. The prebuilt ZIP needs runtime dependencies installed with npm; it is not a standalone executable. Downloads are available from [GitHub Releases](https://github.com/Legimity/shellter/releases). The npm package is not published.

## Supported boundaries

- Independent MCP probing supports stdio and Streamable HTTP. It reports native loading as unknown; it does not prove native-client OAuth or loading.
- Authentication stays with the native client. Shellter provides guidance rather than transferring tokens or automating login.
- Cross-client instruction conversion, binary attachments, file-resource deletion, and a full machine-local override model are not implemented.
- Unsupported permission mappings block planning. Absolute launch arguments need explicit path or literal classification; Shellter does not guess their meaning.
- npm dependency installation is optional, requires explicit approval, and needs local executable binding afterward. Configuration recovery does not undo installation or authentication.

## Recovery and private data

Review selected content before adoption or export. Backup journals can contain original credentials and belong in private local storage, outside Git and transfer packages. Imported resources are not executed automatically.

Recovery checks for later edits and refuses conflicting drift. External programs do not obey Shellter's locks, so cross-file atomicity and elimination of all races are not promised.

For detailed implementation evidence and remaining work, see [development documentation](DEVELOPMENT.md). For commands, see the [CLI guide](CLI.md).
