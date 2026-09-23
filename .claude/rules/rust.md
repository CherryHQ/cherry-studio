---
paths: ['**/*.rs', '**/Cargo.toml', '**/Cargo.lock', '**/clippy.toml']
---

<!-- prometheus-mini-context:start v1 -->
# Rust development

Load `prometheus-rust-workspace` before Rust implementation, review, refactoring,
or architecture work. Use `rust-best-practices` generally,
`rust-async-patterns` for Tokio and concurrency, and
`rust-mcp-server-generator` for MCP servers and transports. Project dependency
pins and protocol versions remain authoritative.

- Batch related implementation and use static reasoning or rust-analyzer until a
  meaningful production path is complete.
- Use a narrow package compiler check earlier only when required to unblock work.
- At a completed change boundary, run the smallest integration target that enters
  through a public API, binary, protocol, process, filesystem, database, or network
  boundary with real collaborators.
- Unit, module-local, mock-only, and filtered-function tests are not completion
  evidence. Do not escalate a passing targeted integration without a scope reason.
- Serialize Cargo commands within a workspace and target directory. Account for an
  existing Cargo process, wait on lock contention, and never start retry loops.
- Reserve workspace-wide, release, cross-compile, feature-matrix, Miri, fuzzing,
  coverage, benchmark, documentation, and audit commands for the final applicable
  boundary or an explicit request.
- After failure, read all diagnostics, batch fixes, and rerun only the smallest
  integration gate that confirms the completed behavior.
- Report commands, results, intentional deferrals, and any remaining integration gate.
<!-- prometheus-mini-context:end -->
