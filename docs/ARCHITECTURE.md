# Architecture

Shellter has a TypeScript core, a CLI and a local React web interface. Both interfaces use the same commands and application behavior.

## Data flow

1. **Scan** selected native configurations and resource directories.
2. **Adopt** reviewed resources into a managed source.
3. **Plan** target changes, including paths, content differences and conflicts.
4. **Apply** the reviewed plan with source/target drift checks and a recovery journal.
5. **Check** file state and prerequisites; explicitly probe MCP connections when requested.

Export/import carries the managed resources in a versioned ZIP. Authentication stays with native clients. A target project path must be mapped explicitly.

## Main modules

| Module | Responsibility |
| --- | --- |
| `src/model.ts` | Resource, scope, plan and context schemas |
| `src/commands.ts` | Shared validated command contract |
| `src/application.ts` | Scan, adoption, planning, application and operation orchestration |
| `src/adapters.ts` | Native paths, configuration parsing and client-format mapping |
| `src/resources.ts`, `src/paths.ts` | Text resource scanning and explicit path mapping |
| `src/policy.ts`, `src/security.ts` | Portable-field rules, secret heuristics and filesystem checks |
| `src/storage.ts` | Private storage, journals, locks, drift-aware recovery |
| `src/bundle.ts` | Versioned package validation and import/export |
| `src/migration.ts`, `src/verification.ts` | Passive checks and separately approved MCP probing |
| `src/server.ts` | Loopback HTTP service, session and origin checks |
| `src/cli.ts`, `web/main.tsx` | CLI and bilingual local web interface |

## Design constraints

- Keep native fields outside the managed scope and preserve comments when editing JSONC/TOML.
- Reject unsupported mappings rather than silently changing permissions or authentication semantics.
- Detect changes since planning before applying or recovering.
- Keep backup state private; it may contain original credentials.
- Never execute imported scripts merely to inspect a bundle.
- Keep configuration match, prerequisites, authentication, independent probing and native loading as separate evidence.

Recovery covers recorded configuration writes. It does not reverse external installations, authentication or arbitrary native-client side effects, and does not promise cross-file atomicity against other writers. See [compatibility](COMPATIBILITY.md).
