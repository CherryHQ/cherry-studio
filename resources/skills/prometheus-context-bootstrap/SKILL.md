---
name: prometheus-context-bootstrap
description: Install compact, layered Prometheus agent context into a project with Node-only, copy-mode behavior. Use when initializing or refreshing AGENTS.md, CLAUDE.md, path-scoped Rust or TypeScript rules, and project-local Rust skill routing on Windows, macOS, or Linux. Do NOT use for global skill installation or for replacing operator-owned project prose.
license: MIT
compatibility: Node.js LTS (>= 22); no shell, Python, symlinks, or executable bit required
metadata:
  version: '1.0.0'
---

# Prometheus Context Bootstrap

Install the compact resident contract, path-scoped stack rules, and project-local
skill copies. The bootstrap owns only marked regions. It preserves prose outside
those markers and refuses a corrupt marker pair or a symlink that resolves outside
the target project.

The generated policy finishes every planned production change in the phase before
testing. It runs one real integration flow at the final phase boundary as evidence.
When the harness provides an agent team, implementation roles work first and review,
audit, verification, and integration-checker roles remain dormant until that boundary.
Unit, mock-only, filtered-function, and per-edit test loops do not count as proof.

## Run from the mini pack

From a standalone mini checkout:

```text
boss-mini prometheus-context-bootstrap.mjs --path <project> --stacks rust,typescript
boss-mini prometheus-context-bootstrap.mjs --path <project> --stacks rust,typescript --check
```

From the copy vendored inside `the-boss`:

```text
node resources/prometheus-skills-mini/scripts/prometheus-context-bootstrap.mjs --path . --stacks typescript,rust
node resources/prometheus-skills-mini/scripts/prometheus-context-bootstrap.mjs --path . --stacks typescript,rust --check
```

Use `--dry-run` to print the complete write plan without changing files. If
`--stacks` is absent, a root `Cargo.toml` selects Rust and a root `package.json`
selects TypeScript.

## Installed context

- a marked resident block in `AGENTS.md`, or in the in-project target of an
  existing `AGENTS.md` symlink;
- an `@AGENTS.md` import in a separate `CLAUDE.md`;
- marked `.claude/rules/rust.md` and/or `typescript.md` regions;
- copied `prometheus-context-bootstrap` and, for Rust, `prometheus-rust-workspace`
  skills under both `.agents/skills/` and `.claude/skills/`;
- missing append-only `.prometheus` context files and directories.

The Rust path rule loads `prometheus-rust-workspace`, which routes
`rust-best-practices`, `rust-async-patterns`, `rust-mcp-server-generator`, and
the specialized catalog only when relevant. Dependency and protocol pins in the
target project remain authoritative.
