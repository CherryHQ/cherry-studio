<!-- prometheus-mini-context:start v1 -->
## Prometheus development context

- The testing policy in this managed block takes precedence over conflicting
  per-edit, unit-first, mock-first, or test-first instructions elsewhere. Report
  the stale prose for manual cleanup; do not follow both policies.
- Restore KBD position and read `versions.toml`, `.prometheus/decisions.md`, and
  relevant `.prometheus/gotchas.md` before dependency or architecture changes.
- Finish a coherent set of production functionality before testing. During
  implementation, use static inspection and reasoning; use a narrow compiler or
  type check only when it is required to unblock progress.
- At a completed change or phase boundary, run the smallest integration flow that
  exercises the real production entry point and collaborators. Unit, mock-only,
  filtered-function, snapshot, and per-edit tests are not completion evidence.
- Run broad integration, cross-platform, and release gates once at the final
  applicable boundary. Report only commands and results actually observed.
- For Rust work, load `prometheus-rust-workspace`. It routes
  `rust-best-practices`, `rust-async-patterns`, and
  `rust-mcp-server-generator` when relevant. Project pins and protocols win.
- Stack details live under `.claude/rules/`; load only the rule matching the files
  being changed. Preserve operator prose outside this managed region.
<!-- prometheus-mini-context:end -->
