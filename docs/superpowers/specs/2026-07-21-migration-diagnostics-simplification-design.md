# Migration Diagnostics Simplification Design

- Date: 2026-07-21
- Status: approved
- Working document: [v1 → v2 migration diagnostics simplification and real-scenario verification](https://mcnnox2fhjfq.feishu.cn/docx/GuhidWzBdoh4l1xGKFxc52acnub)
- Source assessment: [v1 → v2 migration diagnostic coverage assessment](https://mcnnox2fhjfq.feishu.cn/docx/UYygd3kJto6cmvxQoLfcjOWhn5b)
- Branch: `codex/migration-diagnostics-simplified`

## Outcome

Replace the current strict migration-diagnostics implementation with a smaller failure-oriented design that answers four support questions:

1. Where did the migration stop?
2. Which fixed failure class blocked it?
3. What bounded, content-free evidence distinguishes the likely cause?
4. Is the target SQLite file structurally readable after the failure?

The implementation keeps the current renderer and native save interactions, renderer crash/unresponsive handling, and version-incompatibility page. It removes infrastructure that is not required to answer those questions.

## Context

The current diagnostic series adds approximately 19,540 lines across 99 migration-related files compared with the commit immediately before diagnostic implementation. Most of the size comes from:

- five-attempt/200-event timelines and causal-retention algorithms;
- journal v1 → v2 compatibility schemas;
- L0/L1/L2 streamed SQLite child-process protocols and database leases;
- four-file ZIP manifests, fixed-point byte accounting, runtime CRC/central-directory validation, and reopen verification;
- generic payload traversal and per-migrator semantic evidence for successful warnings and skipped records;
- adversarial file-race and native-hang defenses beyond the migration support requirement.

The repository already has the smaller primitives needed for this feature:

- the preboot gate owns a scoped diagnostics object before normal lifecycle bootstrap;
- `MigrationEngine` has explicit initialize, prepare, execute, validate, and finalize boundaries;
- `BaseMigrator` can preserve an original native error before existing migrator code converts it to a display string;
- `MigrationWindowManager` already detects renderer crash and unresponsive events;
- `presentMigrationDiagnosticFailure()` already provides a native save flow;
- the migration renderer already has save, reveal, copy-address, email, concurrency, and action-disable interactions;
- `archiver` is already installed;
- `createAtomicWriteStream()` is the repository filesystem primitive for atomic stream publication;
- all migration paths are owned by `MigrationPaths`.

## Goals

- Preserve current migration behavior, ordering, transactions, retries, and user choices.
- Preserve current migration-window and version-incompatibility styles and interactions.
- Offer a diagnostic ZIP from renderer failures, renderer crash/unresponsive handling, recovery, and native pre-window failures.
- Offer the same native save flow if the version-incompatibility window itself cannot be created.
- Recover a bounded last-failure checkpoint after main/native process exit or machine power loss.
- Capture only failures that actually block the version gate, renderer export, migration engine, or process.
- Capture bounded payload length only at a real failed write boundary.
- Use a real ZIP and real file-backed SQLite in the closest integration tests.
- Cover the source document's historical scenarios and fourteen fixtures according to their current code reachability.

## Non-goals

- Native crash stacks, minidumps, exact segmentation-fault causes, or process-wide crash reporting.
- Physically cutting power or building a VM power-loss laboratory.
- Rolling back arbitrary external filesystem writes made by existing migrators.
- Moving migration execution into a child process or adding a migration kill watchdog.
- Diagnosing local adversarial file replacement, inode swaps, WAL/SHM races, or archive tampering.
- Profiling successful rows or recording general dataset-size statistics.
- Turning warnings, skipped records, defaults, or degraded-but-successful paths into fatal issues.
- Preserving development-only four-file ZIP or journal v1/v2 contracts that have not shipped.
- Uploading or emailing diagnostics automatically.
- Replacing the migration IPC subsystem with IpcApi.
- Running the repository-wide test suite.

## Approved decisions

### D0 — Baseline

The new branch starts from the current local strict-diagnostics branch. Changes are selectively simplified; the implementation is not mechanically reset to the pre-diagnostics commit. Existing UI/interaction work and unrelated migration fixes remain.

### D1 — Process interruption

- Renderer crash or unresponsive state: the surviving main process immediately opens the existing native save flow.
- Main/native crash or power loss: the next launch reads the unfinished checkpoint and offers save/retry.
- The package reports only the last known scope, migrator, phase, and fixed evidence. It does not claim a native stack or exact crash instruction.

### D1.1 — Minimal checkpoint

The journal stores only the previous failed/interrupted attempt summary and the current attempt. It does not store a general event timeline, five attempts, 200 events, or a causal-retention plan.

### D2 — One-shot SQLite diagnostics

The main process performs native-free file/header inspection. A one-shot read-only child process performs `quick_check`, `foreign_key_check`, and checks a fixed allowlist of key tables and columns. Timeout, invalid output, or child exit becomes `unavailable`; native-free evidence remains usable.

### D3 — Two-file ZIP

The archive contains exactly:

- `migration-diagnostics.json`
- `README.txt`

The builder uses one strict JSON schema, `archiver`, and `createAtomicWriteStream()`. It does not reopen its own output or implement CRC, central-directory, inode, or publication-race validation.

### D4 — Blocking failures only

A diagnostic failure exists only when the current code path:

- blocks the upgrade-path gate;
- terminates renderer export;
- makes `MigrationEngine` throw or return `success: false`; or
- interrupts the migration process.

The three version-incompatibility reasons are the only exception: they block upgrade before migration execution and are therefore diagnostic outcomes even though migration did not fail.

### D5 — Capacity and compatibility

- The sum of uncompressed ZIP entries remains limited to 1 MiB.
- Schema field lengths and array cardinalities make the document bounded by construction; there is no dynamic priority-based trimming.
- `migration-diagnostics.json` uses `formatVersion: 1`.
- Development-only old ZIP formats have no reader.
- Development-only old journals are treated as invalid diagnostic state and quarantined; business data and migration eligibility are unaffected.

## Architecture

```text
actual failure owner
  ├─ version policy / preboot gate
  ├─ renderer exporter
  ├─ MigrationEngine phase boundary
  ├─ BaseMigrator failed write wrapper
  └─ renderer process event
          │ fixed, bounded evidence only
          ▼
MigrationDiagnosticsCoordinator
  ├─ in-memory current attempt
  ├─ atomic minimal checkpoint
  └─ frozen save snapshot
          │
          ├───────────────┐
          ▼               ▼
native-free DB L0    one-shot SQLite child
          └───────┬───────┘
                  ▼
MigrationDiagnosticBundleBuilder
  ├─ strict migration-diagnostics.json
  ├─ static README.txt
  └─ archiver → createAtomicWriteStream
                  │
                  ▼
renderer or native save outcome
```

The coordinator remains preboot-scoped and explicitly injected. It is not a lifecycle service or global singleton.

## Data contracts

### Failure classification

`failureKind` is a closed enum:

- `upgrade_path_blocked`
- `preboot_failed`
- `renderer_export_failed`
- `source_prepare_failed`
- `migration_write_failed`
- `migration_invariant_failed`
- `migration_validation_failed`
- `migration_finalize_failed`
- `process_interrupted`

Every failure contains:

- `kind`;
- `scope`;
- `phase`;
- stable `errorCode`;
- optional production `migratorId`;
- optional strict evidence branch owned by that failure boundary.

It never contains a raw exception, stack, SQL statement, path, constraint name, record identifier, source value, or user content.

### Stable error codes

The existing native error classifier is reduced to codes that distinguish reachable blocking outcomes:

- SQLite: open, corrupt/not-a-database, schema, constraint, read-only/permission, too-big, busy/locked, I/O, and unknown database error;
- filesystem: missing, permission/read-only, I/O, and unknown filesystem error;
- source: read, parse, serialization, rejected-required-records, and invalid identifier;
- validation: count mismatch, required target field/relation, material/vector, foreign key, and status finalization;
- process: renderer gone, renderer unresponsive, child timeout/exit, and interrupted;
- gate: the three fixed `VersionBlockReason` values;
- unknown: only when the real owner cannot safely classify the thrown value.

The classifier runs while the original error still exists. Bundle code never parses a display message to infer a cause.

### Evidence branches

Only the following bounded evidence is allowed:

- version gate: reason, safe version context, and version-log state;
- renderer export: source role and operation role;
- prepare: source role and the aggregate fact that all required records were rejected;
- execute: operation/dependency/invariant role and, only for a failed write, payload length evidence;
- validate/finalize: check role plus bounded expected/actual count information;
- interruption: last known scope, migrator, phase, and recovery source.

An isolated missing MCP/Assistant/MiniApp field that existing code skips does not create a failure. If all required source rows are rejected and prepare fails, the aggregate failure may record the fixed missing-field role and a count bucket.

### Payload length

Length collection is lazy and failure-only:

- it executes after an existing write throws;
- it does not clone a BLOB, allocate a second vector buffer, or serialize successful data for diagnostics;
- it records a fixed value role, value kind (`string`, `json`, or `blob`), and bounded byte-length bucket;
- exact byte counts may remain in the in-memory/local JSON only when bounded by the schema and needed to distinguish `SQLITE_TOOBIG`; no value bytes or hashes are retained;
- it never replaces the original write error if profiling itself fails.

The existing per-write wrappers may remain where they preserve a swallowed native SQLite code. The generic deep object profiler, successful-row profiling, and per-domain descriptor matrix are removed.

### Checkpoint

The journal is a strict object with:

- `formatVersion: 1`;
- safe app/platform/architecture metadata;
- optional `previous` failed/interrupted attempt summary;
- optional `current` attempt summary;
- current session state;
- at most one bounded warning count summary for the existing completed-with-warnings interaction.

An attempt summary contains its trigger, status, start/end timestamps, last location, and optional fatal evidence. No arbitrary event array exists.

Checkpoint publication remains atomic and bounded. Corrupt or incompatible diagnostic state is quarantined with a small fixed retention count. A checkpoint write failure disables cross-launch recovery for that attempt but does not change the migration result or become a migration root cause.

### Bundle document

`migration-diagnostics.json` contains:

- `formatVersion: 1`;
- safe generation/app/platform/architecture metadata;
- current and optional recovered attempt summaries;
- optional fatal failure evidence;
- a non-fatal warning count summary when the existing completed-warning save interaction is used;
- database file/header evidence;
- SQLite child result or fixed `unavailable` status.

The document is schema-validated before the archive stream is created. All strings and arrays have explicit maximums. If a programming error still produces an oversized document, save returns `bundle_save_failed` and no destination is published.

`README.txt` explains the two entries, privacy exclusions, child-diagnostics availability, manual attachment flow, and absence of automatic upload.

## Components

### `MigrationDiagnosticsCoordinator`

Responsibilities:

- own the current attempt and at most one recovered summary;
- persist the checkpoint after meaningful location/failure changes;
- close an unfinished current attempt as interrupted during recovery;
- produce one frozen save snapshot;
- serialize concurrent save attempts with the existing `save_in_progress` result;
- remove the journal after successful migration reconciliation.

It does not rank events, upgrade old journal versions, or own database inspection.

### `MigrationEngine` integration

The engine records only existing control-flow boundaries:

- database/engine initialize;
- migrator prepare;
- migrator execute;
- migrator validate;
- final foreign-key validation;
- completion/failure status write.

The wrappers observe the existing result. They do not change migrator ordering, transaction ownership, error messages returned to the UI, cleanup ordering, retry semantics, or status semantics.

Migrator-specific code is retained only where the existing migrator catches an original exception and converts it to a result string. That code passes fixed classification and optional failed-write length evidence back to the engine. Successful warnings and skipped rows are not emitted as fatal diagnostics.

### `MigrationDatabaseDiagnostics`

Parent process:

- validates the `MigrationPaths.databaseFile` input;
- uses bounded `lstat` and header reads only;
- records existence, regular-file status, safe size bucket, SQLite-header validity, and sidecar presence booleans when available;
- starts one child and enforces one timeout.

Child process:

- opens the database read-only;
- runs bounded `quick_check`;
- runs `foreign_key_check` and caps returned violation roles/counts;
- checks a fixed set of migration-critical tables and columns;
- sends exactly one schema-validated result and exits.

There is no L0/L1/L2 stream, ready handshake, lease, inode identity, WAL race analysis, full schema dump, index/trigger inventory, or partial message accumulation.

### `MigrationDiagnosticBundleBuilder`

Responsibilities:

- parse the frozen snapshot and database result with the unified schema;
- serialize one JSON entry and one static README entry;
- enforce the 1 MiB uncompressed sum;
- pipe `archiver` to `createAtomicWriteStream()`;
- return `saved`, `canceled`, `save_in_progress`, or the unified `bundle_save_failed` outcome expected by the UI/native adapters.

The builder does not reopen the ZIP, inspect local/central headers, recompute CRCs, manage custom temp filenames, or implement retry loops around file close.

### Renderer and native entry points

Retain the current interactions:

- save bundle;
- disable save/restart/close while saving;
- reveal the saved ZIP;
- copy the support address;
- open the user's email client with instructions;
- show a localized save failure;
- never upload or attach automatically.

The renderer page layout and version-incompatibility page width/buttons remain unchanged.

Native failures before the migration renderer is usable call `presentMigrationDiagnosticFailure()`. Renderer crash and unresponsive signals claim the existing single native failure flow so duplicate dialogs cannot race.

## Version incompatibility

The version policy continues to own exactly three reasons:

- `no_version_log`
- `v1_too_old`
- `v2_gateway_skipped`

For each reason, the gate records a fixed `upgrade_path_blocked` outcome, opens the existing version-incompatibility page, and exposes the existing diagnostic save panel.

The current version-window creation catch uses `dialog.showErrorBox()` and exits. Replace only that fallback with the existing native diagnostic dialog using `version_window_failed`, then apply the same quit/retry decision handling already used for migration-window creation failures. No new component or styling is introduced.

## Failure behavior

- Diagnostic recording is best-effort and cannot replace the original migration error.
- Invalid diagnostic candidates are rejected rather than partially copied into a bundle.
- SQLite child timeout/exit affects only `database.status`; it is not reported as the migration root cause.
- Archive/publication failure affects only save outcome; it is not reported as the migration root cause.
- A successful migration with ordinary skipped/defaulted records has no fatal failure entry.
- A successful migration with existing warnings may retain the current save interaction, but the JSON marks it as completed with a bounded warning count rather than a fatal issue.
- Main/native process interruption is reported only from the last durable checkpoint on the next launch.
- Renderer crash/unresponsive is reported immediately while main remains alive.

## Privacy and capacity

The archive excludes:

- application and migration logs;
- database, WAL, SHM, journal, and export files;
- SQL, raw errors, stacks, and constraint text;
- absolute paths and filenames;
- credentials, URLs, commands, environment values, and user content;
- record IDs, source IDs, names, and hashes/fingerprints derived from them.

Allowed metadata is restricted to enums, booleans, timestamps, normalized app version, platform/architecture, safe migrator roles, bounded counts, and failure-only length measurements.

Tests place privacy canaries in raw errors, paths, SQL, tokens, IDs, and source values and inspect the checkpoint plus both extracted ZIP entries.

## Historical-scenario coverage

| Source scenario | Simplified coverage |
| --- | --- |
| Agents foreign-key violation | Real file-backed database; engine/migrator attribution, fixed child/parent role, bounded violation count. |
| Internal error / `UnknownError` | Fail an actual renderer exporter operation and cross the renderer-to-main report boundary. |
| MCP missing id/name | Fatal case only when all required rows are rejected; separately prove one skipped row remains non-fatal and produces no fatal issue. |
| MCP type CHECK | Run the current schema/transform reproduction. Add no dedicated production evidence if the real path does not fail. Document the probe result. |
| Provider Model ID with reserved character | Run the actual transform and record the fixed invalid-identifier rule without the identifier or character. |
| Missing `version.log` | Gate produces `no_version_log`, opens the version page, and saves a real ZIP. |
| Displayed 1.8.4 versus previously run 1.9.11 | Use a real temporary version log and selection/evaluation path; record safe version context and the resulting fixed gate decision. |

## Fourteen-fixture coverage

| Fixture | Role in the simplified design |
| --- | --- |
| `database-open` | Fatal root-cause fixture. |
| `database-corrupt` | Fatal root-cause fixture plus SQLite diagnostic result. |
| `database-schema` | Fatal initialization/validation fixture. |
| `database-constraint` | Fatal execute fixture. |
| `oversized-string` | Fatal failed-write length fixture. |
| `oversized-json` | Fatal failed-write length fixture. |
| `oversized-blob` | Fatal failed-write length fixture without copying the BLOB. |
| `source-parse` | Fatal renderer or prepare fixture owned by the actual parser. |
| `path-permission` | Fatal export/database path fixture. |
| `archive-finalization-failure` | Support-chain test only; returns `bundle_save_failed`, never a migration root cause. |
| `renderer-crash` | Immediate native save fixture. |
| `renderer-hang` | Immediate native save fixture. |
| `database-process-partial` | Support-chain test only; database diagnostics becomes unavailable while ZIP remains saveable. |
| `retry-recovery` | Durable interrupted checkpoint, next-launch save, and existing retry flow. |

At least one renderer-process scenario is exercised through a real Electron migration window. Physical power loss and a native SQLite hang are represented by deterministic process/checkpoint fixtures, not machine-level destructive tests.

## Targeted verification

No repository-wide `pnpm test` or `pnpm build:check` is run because `build:check` expands to the full test suite. Verification is limited to:

- strict schema unit tests;
- coordinator/journal recovery tests;
- bundle builder unit and real-ZIP extraction integration tests;
- native-free and child SQLite diagnostic tests with real file-backed databases;
- `MigrationEngine` phase/fatal-boundary tests;
- selected migrator tests for swallowed native errors, aggregate required-field failure, invalid identifiers, foreign keys, and failed-write length;
- renderer export, migration IPC, migration window crash/unresponsive, native dialog, version policy, version page, and preboot gate tests;
- the seven-scenario/fourteen-fixture acceptance matrix;
- one negative regression proving non-fatal missing-field skip does not create a fatal issue;
- `pnpm lint`, `pnpm format`, and `pnpm docs:check-links` after targeted tests.

Database tests use `setupTestDatabase()` and production migrations. They do not hand-write schema SQL or stub Drizzle chains.

## File-impact strategy

### Preserve

- renderer diagnostic panel layout and saved actions;
- migration window controls and save concurrency behavior;
- native diagnostic dialog/i18n surfaces;
- renderer crash/unresponsive interception and single-claim behavior;
- version policy and version-incompatibility page;
- migration ordering, transactions, status writes, retries, and cleanup behavior;
- `MigrationPaths` ownership of diagnostic paths.

### Simplify in place

- `MigrationDiagnosticsCoordinator.ts`;
- `migrationDiagnosticsJournal.ts`;
- `migrationDiagnosticsSchemas.ts`;
- `MigrationDatabaseDiagnostics.ts` and its child;
- `MigrationDiagnosticBundleBuilder.ts`;
- `migrationErrorClassifier.ts`;
- failure-only payload length handling;
- gate/engine/IPC adapters and their tests;
- the migration diagnostics README and acceptance fixtures.

### Remove when orphaned

- journal v1 schema and v1 → v2 upgrade code;
- causal-retention policy;
- four-document bundle schemas and manifest logic;
- ZIP canonical-header/CRC/reopen code;
- L0/L1/L2 streaming protocol and database lease module;
- generic successful-payload profiler and broad semantic-warning branches;
- tests whose only purpose is a removed defensive mechanism.

### Do not touch

- generated data-classification files;
- database schemas or Drizzle migrations unless a targeted real fixture proves a migration bug that the user separately authorizes;
- unrelated v1 data code;
- unrelated application features changed on the branch.

## Acceptance criteria

The implementation is complete when:

1. Every user-visible diagnostic save entry produces the same two-entry ZIP contract.
2. All fatal issue records correspond to a gate block, export termination, engine failure, or process interruption.
3. Non-fatal missing-field/skip/default/degrade paths do not produce fatal issues.
4. Failed writes can report bounded payload length without recording payload content.
5. Renderer crash/unresponsive opens the native save flow immediately.
6. Main/native interruption is recoverable on the next launch from the minimal checkpoint.
7. All three version block reasons reach the existing version page and can save a ZIP.
8. Version-page creation failure reaches the native `version_window_failed` save flow.
9. SQLite child failure does not prevent saving the remaining diagnostic evidence.
10. Archive failure publishes no destination and returns the unified save error.
11. Privacy canaries are absent from the checkpoint and extracted ZIP.
12. Targeted tests, lint, formatting, and documentation-link checks pass; the handoff explicitly states that the full test suite was not run.

## Tradeoffs

- A minimal checkpoint cannot reconstruct a detailed sequence within a phase, but it survives the failures users can act on and is much easier to reason about.
- One-shot SQLite inspection may return unavailable on a damaged/native-hung database, but main-process file/header evidence and migration failure evidence remain saveable.
- Removing development-only compatibility means a developer who ran the strict branch can lose an old diagnostic checkpoint, but never business data; keeping those parsers would permanently preserve unshipped complexity.
- The 1 MiB ceiling is larger than expected output, but reuses an existing tested guard and avoids rejecting useful evidence for negligible user cost.
- Failure-only length capture needs small wrappers around write boundaries whose native errors are otherwise swallowed. This is the only retained per-migrator diagnostic instrumentation and does not change write execution.
