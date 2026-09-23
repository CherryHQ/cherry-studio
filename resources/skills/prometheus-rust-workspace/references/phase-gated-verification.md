# Phase-gated Cargo verification

Optimize for development throughput. Rust builds and tests are expensive and may
contend for Cargo package-cache, registry-cache, build-directory, or workspace locks.
Do not run compilation, linting, testing, benchmarking, documentation, installation,
or dependency-update commands after every edit.

## Change and phase boundaries

A validation boundary exists when a meaningful set of requested production
functionality is fully implemented and wired through a real public entry point. This
can be a completed change or a phase boundary. The user may also request validation.
A narrow compiler check before that boundary is allowed only to diagnose a blocker
that static inspection cannot reasonably resolve.

During a phase:

- inspect and edit without repeatedly compiling;
- batch related edits before validation;
- use rust-analyzer diagnostics and static reasoning for intermediate feedback;
- do not run tests merely because a file changed;
- do not add or run unit, module-local, mock-only, or filtered function tests as
  completion evidence;
- do not rerun Cargo after a small follow-up unless it meaningfully invalidates the
  previous result;
- do not start background Cargo commands, test watchers, or repeated check loops;
- do not run multiple Cargo commands concurrently against the same workspace or
  target directory.

At a completed change or phase boundary, choose the smallest integration gate that
exercises the production entry point and real collaborating components. Repository
commands remain authoritative. Do not run a broader command merely because it exists.

## Level 1 — targeted integration

Use for completed behavior localized to one package or integration target:

```bash
cargo test -p <package> --test <integration-target>
```

The test must enter through a public API, binary, protocol, process, filesystem,
database, or network boundary. Do not use a unit-test name filter as a substitute.
Do not automatically escalate when the targeted integration succeeds.

## Level 2 — affected integration surfaces

Use when completed behavior affects multiple public surfaces, feature profiles, or
downstream packages. Run each relevant integration target once using the repository's
documented selectors, for example:

```bash
cargo test -p <package> --test <integration-target-a>
cargo test -p <package> --test <integration-target-b> --features <relevant-features>
```

Add only feature flags relevant to the change. Do not use `--all-features` by
default.

## Level 3 — phase integration gate

Reserve this for a completed phase, cross-workspace behavior, shared public APIs,
workspace configuration or dependency changes, release preparation, CI-equivalent
local verification, or an explicit user request. Prefer the repository's documented
integration-only selector, for example:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --test '*'
```

Use `--all-features` only when the project explicitly supports building all features
together or the user requests it. Do not use a broad selector that silently adds unit
test harnesses when an integration-only selector is available.

## Failure and escalation

1. Read all relevant diagnostics from the existing command.
2. Batch the necessary fixes.
3. Do not rerun after each individual edit.
4. Rerun only the smallest integration command that can confirm the fixes.
5. Escalate only when the failure or change crosses package boundaries.

A successful targeted integration does not require an immediate workspace-wide gate.
Defer the broader integration suite until the complete phase is finished.

## Locks, caches, and formatting

- Serialize Cargo commands for a workspace unless the user explicitly requests an
  isolated concurrent build.
- Account for any Cargo process already running before starting an expensive command.
- Reuse the workspace target directory; do not clear caches or run `cargo clean`.
- Do not change `Cargo.lock` unless dependency resolution is part of the task.
- If Cargo waits for a lock, identify or wait for the existing process and reuse its
  results when possible. Do not spawn retries.
- Do not create a separate `CARGO_TARGET_DIR` merely to bypass ordinary contention;
  it may duplicate the full compilation cost.
- Format once at a coherent phase boundary or before final verification. Prefer the
  affected files or package and avoid unrelated churn.

## Opt-in commands

Run audit, deny, Miri, benchmarks, documentation, fuzzing, Loom, sanitizers,
coverage, cross-compilation, full feature matrices, and release builds only at a
final task, release, or security boundary; when directly relevant to the requested
change; or when explicitly requested.

## Reporting

Report commands run, success or failure, intentional deferrals, and whether full
workspace validation remains recommended. Never claim that a deferred check passed.
