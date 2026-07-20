# Migration Diagnostics Semantic Evidence Design

- Date: 2026-07-20
- Status: conversational design approved; awaiting repository specification review
- Source: [v1 → v2 迁移诊断覆盖评估与补足建议](https://mcnnox2fhjfq.feishu.cn/docx/UYygd3kJto6cmvxQoLfcjOWhn5b)

## Outcome

Improve strict v1 → v2 migration diagnostics so a support ZIP preserves the bounded fact that caused a failure or warning, with particular attention to the weak real-world cases in section 5.5 of the source document.

The implementation must remain a privacy-minimized triage index. It must not become a forensic bundle, a correctness repair, a general logging mechanism, or a scenario-specific rule engine.

## Scope

This change covers:

- causal-event retention in the journal and bundle;
- strict, low-entropy semantic evidence for renderer export failures, missing required source fields, invalid unique model identifiers, and version/directory selection;
- producer-owned classification at the real failure or warning boundary;
- an explicit v2 journal and support-bundle event contract;
- representative real-failure-to-ZIP acceptance coverage;
- the existing strict four-entry ZIP, five-attempt, 200-event, and privacy invariants;
- increasing the uncompressed ZIP-entry budget from 1 MiB to 2 MiB while leaving the journal budget at 1 MiB.

## Non-goals

The change does not:

- include application or migration logs, raw errors, stacks, SQL, paths, database files, exported business data, identifiers, credentials, constraint names, or user content;
- repair, rewrite, or normalize user data beyond current migration behavior;
- change MCP missing-ID skip behavior or Provider Model invalid-ID failure behavior;
- build packaged-app, crash, hang, unresponsive, OS-account, or VM scenario infrastructure from section 6.4;
- address migration correctness issues from section 6.5;
- add UI, telemetry, automatic upload, automatic email attachment, or another support-bundle entry;
- migrate the preboot migration IPC subsystem to IpcApi;
- add MCP CHECK evidence without a failure reproducible against the current schema and transform path;
- run the repository-wide `pnpm test` suite.

## Repository precedent

The design extends existing repository patterns instead of introducing a second diagnostic model:

- `migrationVersionGateContextSchema` already combines a fixed code with a strict discriminated context and binds it to one event shape with `superRefine`.
- Payload and database diagnostics use allowlisted roles, bounded buckets, strict objects, and cross-field invariants.
- `BaseMigrator` captures bounded facts at the caught operation boundary and deliberately avoids inspecting error text.
- `MigrationDiagnosticBundleBuilder` copies validated allowlisted fields rather than inferring root causes.
- Shared IPC and DataApi schemas use strict discriminated unions for mutually exclusive states.

The selected approach is therefore a hybrid: use a fixed `code` when it expresses the whole root fact, and attach a strict `semanticEvidence` branch only for a small number of orthogonal facts. A free-form evidence dictionary is prohibited.

## Privacy model

The support ZIP is privacy-minimized, not anonymous and not free of all privacy-relevant metadata. Existing fields such as normalized app version, platform, architecture, timestamps, migrator role, and count buckets can reveal limited usage metadata. The guarantee is narrower and testable:

> No user content or user-identifying value; only bounded, low-entropy diagnostic metadata; generated locally and never uploaded automatically.

### Prohibited data

The journal and ZIP must not contain:

- actual Provider, Model, MCP, file, assistant, message, topic, or database record identifiers;
- MCP names, URLs, commands, arguments, environment values, or configuration values;
- raw version-log lines, executable paths, directory paths, filenames, or database paths;
- raw exceptions, error messages, stacks, SQL, SQLite messages, or constraint names;
- actual invalid characters or source substrings;
- hashes, fingerprints, encrypted values, or truncated values derived from user data;
- total user dataset sizes when only an affected-record count is required;
- a generic `Record<string, unknown>`, arbitrary context bag, or free string in semantic evidence.

### Allowed data

Only source-defined enums, booleans, normalized versions, and coarse count buckets may be added. Every new dimension must have a concrete triage consumer. Evidence is emitted only for a failure, unavailable result, or warning; successful lifecycle events do not acquire semantic evidence.

The existing raw renderer error may still be used for local UI and central logging. It must be passed separately from the fixed diagnostic report and must never reach the coordinator, journal, or bundle builder. Logs remain excluded from the ZIP.

## Ownership and data flow

The flow is fixed:

```text
fact owner
  -> strict producer or IPC contract
  -> MigrationDiagnosticsCoordinator
  -> v2 journal
  -> allowlist-only bundle projection
  -> v2 migration-events.json / manifest.json
```

The bundle builder never parses messages, classifies raw exceptions, or synthesizes semantic evidence.

### Renderer exporters

Renderer exporters own their source and operation roles. A renderer-private typed error carries only fixed diagnostic roles and retains the original exception as its runtime cause for UI/logging. Each exporter wraps the operation it owns rather than relying on the top-level component to infer a stage.

The exporter phase and the `StartMigration` handoff are caught separately. A `StartMigration` rejection remains owned by Main and is not re-reported as a renderer export failure.

The existing preboot migration IPC channel remains in place. Its renderer error payload is split into:

- the existing display message, which is never passed to diagnostic capabilities; and
- a strict fixed renderer-export report.

An invalid report is rejected in full and replaced by the fixed `unknown/unknown` fallback. Unknown fields are never silently stripped and forwarded.

Main owns `mkdir` and `writeFile` failures in `WriteExportFile`. The renderer supplies a validated source role, but Main classifies the caught filesystem error immediately with the existing migration error classifier. Neither side parses a serialized error message. The fixed same-generation classification is used when the renderer finishes the failed export attempt.

### MCP missing required source ID

`McpServerMigrator.prepare` owns the existing missing-ID branch. It tracks a dedicated missing-ID count, separate from duplicate and transform-failure counts, and emits one aggregate diagnostic warning. It does not emit one event per server and does not copy the existing warning string, server name, or server ID.

Current migration results and UI warnings remain unchanged.

### Provider Model identifiers

`createUniqueModelId` owns identifier validity. The shared owner gains a typed validation violation that covers all of its existing rules, and `createUniqueModelId` reuses that validation while preserving its current valid/invalid behavior and display message.

The fixed violation is one of:

- `provider_id / empty`;
- `provider_id / contains_separator`;
- `model_id / empty`;
- `model_id / contains_reserved_route_character`.

`ProviderModelMigrator` records only the fixed violation and rethrows or returns the same migration failure as today. It does not duplicate the separator/reserved-character list and does not parse the exception message.

### Directory and version selection

`selectLegacyUserData` and `resolveMigrationPaths` own the directory-selection role. The result carries a fixed role without exposing a path. Exact mappings that resolve to the current directory retain their semantic role rather than collapsing to an indistinguishable default result.

`evaluateCandidateVersion` owns the version-log summary. Reading returns the selected previous version plus bounded parsing facts. The migration gate attaches those owner-produced facts to the existing `versionGate` context; it does not reread the file or infer a reason.

### MCP CHECK

No MCP CHECK evidence branch is part of the initial production contract. A targeted current-schema probe may validate whether the historical type CHECK failure still exists. If it does not reproduce, no permanent schema branch is added. If it does reproduce, adding a CHECK branch requires an explicit specification amendment before implementation; the real constraint role and safe boundary must come from that fixture.

## Strict event contract

### Top-level changes

Add two error codes:

- `missing_required_field`;
- `invalid_identifier`.

Add non-terminal event state `warning`. Attempt terminal outcomes remain `completed`, `failed`, and `interrupted`; a warning can never be the last terminal event of a finished attempt.

Journal producer input accepts only production migrator IDs. Persisted and upgraded events may additionally use the fixed `unknown` fallback. Arbitrary strings are rejected.

### Semantic evidence

`semanticEvidence` is an optional strict discriminated union. It has no generic branch.

#### `renderer_export_failure`

Fields:

- `kind = renderer_export_failure`;
- `sourceRole`;
- `operationRole`.

Legal source/operation combinations are:

| sourceRole | operationRole |
| --- | --- |
| `redux` | `read`, `parse` |
| `dexie` | `open`, `read`, `serialize`, `write` |
| `local_storage` | `read`, `serialize`, `write` |
| `unknown` | `unknown` |

The evidence binds to `scope=renderer_export`, `phase=finalize`, and `state=failed`. The top-level `code/category` remains the failure classification: `source_parse` for an owner-known parse failure, a classified filesystem code for a Main-owned write failure, or `unknown` when the source cannot classify safely. There is no duplicate `failureClass` field.

#### `missing_required_field`

Fields:

- `kind = missing_required_field`;
- `fieldRole = source_id`;
- `affectedCountBucket = 1 | 2-10 | 11+`.

It binds to `scope=migrator`, `phase=prepare`, `state=warning`, `code=missing_required_field`, `category=source`, and `migratorId=mcp_server`.

The underlying event mechanism is reusable, but no additional migrator or field role is opened without a concrete owner and consumer.

#### `invalid_identifier`

Fields:

- `kind = invalid_identifier`;
- `identifierRole = provider_id | model_id`;
- `rule = empty | contains_separator | contains_reserved_route_character`.

The discriminated branches reject impossible role/rule combinations. Evidence binds to `scope=migrator`, `phase=execute`, `state=failed`, `code=invalid_identifier`, `category=source`, and `migratorId=provider_model`.

It has no affected-count field because the current migration stops at the first thrown violation and cannot claim a reliable affected total.

### Version gate context

Version selection extends the existing `versionGate` context rather than adding another semantic-evidence branch.

Add `directorySelectionRole` with fixed values covering the current selection algorithm:

- `current`;
- `boot_config`;
- `legacy_exact`;
- `legacy_fuzzy_eligible`;
- `legacy_fuzzy_blocked`;
- `default`;
- `unknown` for an upgraded legacy journal only.

Replace the coarse present/missing flag with a strict version-log union:

- `{ state: missing }`;
- `{ state: read_failed }`;
- `{ state: parsed, validRecordCountBucket, invalidRecordCountBucket }`.

Record-count buckets are `0 | 1 | 2+ | unknown`. New successful reads always produce a concrete bucket; `unknown` exists only as the safe compatibility fallback for upgraded v1 journal data.

A valid record is a non-empty line with the existing six-part format and a valid semantic version. Counts include the current version; `previousVersion` remains the last valid record that differs from the current app version.

Existing event binding remains mandatory: `scope=gate`, `phase=validate`, `state=unavailable`, and `code=upgrade_path_blocked` must appear together with `versionGate`.

## Causal retention

Retention is centralized in one pure internal policy used by the coordinator and bundle builder. Producers do not set a `causal`, `priority`, or retention field.

For each retained attempt:

1. Always protect the explicit terminal event of a finished attempt.
2. Protect at least one most-informative causal event:
   - first preference: an event with `semanticEvidence`, `payloadProfile`, or `versionGate`;
   - fallback: a `failed`, `unavailable`, or `warning` event with a non-`unknown` code.
3. Keep remaining events while within limits, preferring additional causal events over ordinary lifecycle events.
4. Under pressure, drop ordinary lifecycle events before extra causal events.
5. Never drop the protected terminal or protected causal representative.

The policy applies generically to any valid current or future strict evidence branch; it contains no scenario names.

Limits remain five attempts and 200 total events. The journal remains limited to 1 MiB. The four uncompressed ZIP entries together are limited to 2 MiB. Existing bounded database-detail omission remains available after event retention has preserved the minimum causal contract.

## Contract versioning

The persisted and exported event contracts advance explicitly:

- active journal: `version: 2` at `migration-diagnostics-v2.json`;
- `migration-events.json`: `formatVersion: 2`;
- `manifest.json`: `formatVersion: 2`;
- `database-diagnostics.json`: remains version 1 because its schema is unchanged;
- `README.txt`: remains one of the same four fixed entries and is updated to describe the 2 MiB privacy-minimized bundle.

`MigrationPaths` owns both the active v2 journal path and the fixed legacy v1 journal path needed for one-time upgrade.

Journal attachment follows this order:

1. Read v2 when present.
2. Otherwise read v1 with a frozen v1 schema.
3. Convert valid v1 fields to v2, using fixed `unknown` values for facts v1 did not record.
4. Atomically publish v2, then remove v1.
5. Route invalid, unreadable, or oversized v1 through the existing bounded quarantine behavior; never copy it into the support ZIP.

There is no old-ZIP reader or converter.

## Failure behavior

Diagnostics are best-effort with respect to migration behavior, but fail closed with respect to bundle privacy:

- a producer-side diagnostic failure never replaces, wraps, suppresses, or changes the original migration result;
- diagnostic failure logging uses a fixed message and does not log the rejected diagnostic candidate;
- a rejected renderer report becomes the complete fixed unknown fallback, while its display error remains available to the UI;
- an invalid journal or snapshot cannot be partially projected into a ZIP;
- an invalid bundle input returns the existing fixed failure result and does not publish a partial archive;
- successful migrations and existing retry/cancel/close behavior remain unchanged.

## Generalization rule

Section 5.5 is a representative validation subset, not the production architecture.

Production code is generalized by semantic owner and invariant:

- all current renderer exporters use the same strict source/operation mechanism;
- all existing unique-model-ID validation rules use the same typed upstream violation;
- every directory-selection and version-log outcome uses one bounded summary;
- causal retention applies to all strict diagnostic contexts;
- new warning/failure classes extend the discriminated union through an explicit schema change.

Generalization does not mean accepting arbitrary fields. A new semantic dimension still requires a concrete scenario, legitimate owner, privacy review, strict enum, event binding, and consumer.

## Verification design

### Definition of a real-scenario acceptance test

A real-scenario test injects a failure at the actual fact owner, then exercises the real coordinator, journal, bundle builder, ZIP producer, ZIP extraction, and strict document schemas. It may mock Electron or an OS dialog boundary, but it may not prove the feature by directly constructing the final expected diagnostic event.

### Representative section 5.5 matrix

| Scenario | Acceptance evidence |
| --- | --- |
| Agents foreign-key violations | Preserve the existing real-database L2 relationship-summary regression. |
| Renderer internal/UnknownError | Fail an actual exporter operation, cross the strict renderer report boundary, and observe fixed source/operation roles in the terminal ZIP event. |
| MCP missing source ID | Run `McpServerMigrator.prepare`; preserve skip behavior and observe one aggregate warning in the ZIP. |
| MCP type CHECK | Run a targeted current-schema reproduction probe only; do not add a production branch when it is not reproducible. |
| Provider Model ID containing `?` | Run the actual Provider Model transform; preserve failure behavior and observe the fixed model-ID rule without the original ID. |
| Missing version log | Preserve the existing strong diagnostic regression. |
| Displayed old version differs from user history | Use a temporary version log and actual selection/evaluation functions; observe selection role, log state, and count buckets. |

These are representative samples. Unit tests also cover every legal semantic-evidence branch and every illegal cross-field combination, including identifier rules not selected by the real-scenario subset.

### Retention and size

Targeted tests must prove:

- five attempts near 200 events retain each terminal and at least one causal representative in the journal and ZIP;
- the exact four-entry allowlist is unchanged;
- the uncompressed ZIP budget accepts exactly 2 MiB and rejects one additional UTF-8 byte;
- the 1 MiB journal bound remains enforced;
- valid v1 journals upgrade to v2 and invalid/oversized v1 journals cannot enter the ZIP.

### Privacy canaries

Fixtures place distinct canaries in raw errors, Unix and Windows paths, bearer tokens, MCP names and IDs, Provider/Model IDs, SQL, and constraint names. Tests inspect:

1. the persisted journal;
2. each extracted ZIP entry;
3. builder success and failure results.

No canary may appear. Tests also reject unknown fields at every structured-object level and verify that the renderer diagnostic capability receives only the fixed report even when the UI has a raw display message.

Database-backed migrator acceptance tests use the repository `setupTestDatabase()` helper and production migrations. They do not hand-write SQLite schemas or stub Drizzle chains.

### Commands

Do not run the repository-wide `pnpm test` suite.

During implementation, run only affected Vitest files covering schemas, coordinator, journal, bundle builder, acceptance fixtures, renderer migration, migration IPC, MCP, Provider Model, version policy, migration paths, and the v2 gate.

Run the repository-required non-test verification before completion:

- `pnpm lint`;
- `pnpm format`;
- `pnpm build:check`.

The final handoff must explicitly state that the full test suite was not run at the user's request and list the targeted commands that were run.
