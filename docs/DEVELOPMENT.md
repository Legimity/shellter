# Developing Shellter

[README](../README.md) · [Contributing](../CONTRIBUTING.md)

Use Node.js 24. From a source checkout:

```bash
npm ci
npm run typecheck
npm test
npm run demo
```

The demo creates temporary fixtures. `npm start` serves the built interface against your actual HOME; choose resources and review changes before applying them.

## Shared implementation

- [Architecture](ARCHITECTURE.md): application, adapters, storage and verification.
- [CLI](CLI.md): commands and explicit scope/profile options.
- [Compatibility](COMPATIBILITY.md): verified environments and remaining boundaries.
- [Cross-machine case](REMOTE-MIGRATION.md): real migration and native-call evidence.

## Validation and distribution

The [GitHub Actions workflow](../.github/workflows/ci.yml) runs typecheck, tests, the isolated migration/recovery walkthrough, document checks and release-package validation on macOS and Ubuntu.

`npm run release:prepare` builds `artifacts/shellter-0.1.0-node24.zip` and a SHA256 sidecar. The ZIP contains the compiled CLI/webpage, production dependency metadata, demo, user documentation and licenses. After extraction, run `npm ci --omit=dev`; no source build is needed.

The packaging command creates local files only. Maintainers publish a tagged GitHub Release after checking its exact revision and CI results. npm publication is separate; `private: true` prevents accidental npm publishing.

Private states, journals, environment files, temporary outputs and generated archives stay outside Git. The public repository starts from a reviewed source snapshot, without prior private development history.
