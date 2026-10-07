# Shellter 0.1.0

The first public release: a portable home for your AI coding agents.

## What you can do

- Select and reuse Skills across coding agents.
- Export/import configuration ZIPs between machines and map target paths.
- Review configuration changes before applying them.
- Inspect and recover recorded writes, with checks for later edits.
- Use a bilingual local web interface or the same core through the CLI.

## Install

Download **shellter-0.1.0-node24.zip** and its SHA256 file from [GitHub Releases](https://github.com/Legimity/shellter/releases/tag/v0.1.0). With Node.js 24 installed, extract the ZIP and run:

```bash
npm ci --omit=dev
npm run demo
```

Open the printed localhost link. The demo uses temporary files. Run `npm start` afterward to select your own configurations. Initial dependency installation requires network access or a populated npm cache.

## Validation

The macOS → Ubuntu case moved 47 Skills / 112 files to tclaude and CodeBuddy, invoked one Skill in each, and exercised a separate cross-machine stdio MCP fixture through native invocation and recovery. Typecheck, 36 tests, build, extracted-package migration/recovery and local web checks passed on the tested Linux machine. [Full evidence](REMOTE-MIGRATION.md) · [CI runs](https://github.com/Legimity/shellter/actions).

## Compatibility

Adapters cover Codex CLI, Claude Code, CodeBuddy Code CLI and Cursor configuration formats. Native coverage varies by client and resource; see [the compatibility matrix](COMPATIBILITY.md). Credentials remain on each machine. Real-service MCP authentication, CodeBuddy's native MCP path, other Linux environments and Windows still need validation. This package requires Node 24 and is not a standalone binary.

Private configuration, login caches, backup journals and internal development history are excluded from this release. [MIT license](../LICENSE) · [Dependency notices](../THIRD-PARTY-NOTICES.txt).
