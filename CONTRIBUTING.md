# Contributing to Shellter

Thanks for helping make agent configuration easier to move.

## Report a problem

Use [the issue forms](https://github.com/Legimity/shellter/issues/new/choose). Include your OS, Node and native-client versions, source/target scope, reproduction steps, and what you expected. A minimal example with fake values is more useful than a full configuration dump.

Never attach API keys, tokens, login caches, private backup journals, or raw native-client output containing credentials. For vulnerabilities, use [private security reporting](SECURITY.md).

## Make a change

1. For substantial behavior or new client support, open a feature request first so the scope can be agreed.
2. Fork the repository and create a branch for your change.
3. Use Node 24, run `npm ci`, then the checks below.
4. Open a pull request describing the problem, resulting behavior, and validation. Include screenshots for interface changes when useful.

```bash
npm run typecheck
npm test
npm run demo:walkthrough
npm run release:prepare
npm run check:docs
```

Keep tests isolated from your actual HOME and native credentials. Use the shared command layer for CLI/web behavior. Preserve unrelated native fields and comments, and never treat a file write as proof of native loading.

## Compatibility contributions

Document client version, OS, configuration scope and exactly what was checked: file content, discovery, Skill execution, MCP connection, or authentication. Mark untested stages explicitly. Credential-free fixtures and reproducible native checks are welcome.

See [development](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md). Contributions are made under the repository's MIT license.
