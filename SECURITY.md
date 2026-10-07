# Security policy

## Report a vulnerability privately

Please use [GitHub private vulnerability reporting](https://github.com/Legimity/shellter/security/advisories/new). Do not put a suspected vulnerability, credential, or sensitive configuration into a public issue.

Include the affected Shellter version, OS, a minimal reproduction using fake values, expected/actual behavior, and potential impact. If private reporting is temporarily unavailable, open a public issue asking only for a private contact method; omit vulnerability details and sensitive data.

The latest published 0.1.x release is the maintained line. Security fixes are released as patch versions; older releases may require an upgrade. This volunteer project does not promise a response-time SLA.

## Configuration and recovery data

Shellter keeps credentials and native authentication local. Review selected resources before export: heuristic detection cannot prove arbitrary text contains no secrets. Private operation journals can contain original native values and must not be shared or committed.

The local web interface binds to loopback and requires its session entrance. Do not expose it to a public network. Imported resource scripts are not executed merely by inspecting a package; connection probes and dependency installation are separate operations.

See [compatibility and boundaries](docs/COMPATIBILITY.md) for the scope of recovery and verification.
