# Backup & Restore Architecture (v2)

> **This document is the decision authority for Backup v2.** It freezes the approved
> product contract and the implementation mechanisms that satisfy it. Later phases and
> their tests are reviewed *against* this document; where code and this contract
> disagree, one of them is a defect. It is not a history of how the design was reached —
> [Provenance](#10-provenance) records only what later implementers must know about where
> code comes from.

Backup v2 replaces the selective-domain merge design (PR #17206) with a **whole-database
replacement** model that mirrors v1 semantics. Two presets, one shared database payload,
and — for Full only — a fixed resource overlay. Neither preset merges database rows.

```text
Lite result = (backup DB, target files unchanged)
Full result = (backup DB, target files overlaid with backup resources; target-only paths kept)
```

This is deliberately **not** a whole-profile rollback: Full preserves target-only paths
instead of deleting a managed root. See [§2 Product Contract](#2-product-contract).

---

## 1. Approved Defaults (frozen)

These defaults are the contract. They are stated here without qualification; the rest of
the document elaborates the mechanisms that enforce them.

1. **Shared portable DB.** Lite and Full export the same complete portable SQLite
   snapshot. There is no 10/14-domain distinction and no domain stripping.
2. **Full always installs.** Full installs every archive-declared managed resource. An
   existing target is moved aside first; target-only paths remain untouched.
3. **Lite never touches target files.** Missing resources on the target are *disclosed*,
   not a restore blocker.
4. **Managed paths rebase; external paths never auto-activate.** Managed absolute paths
   rebase to target roots resolved through `application.getPath()`. Archive-supplied
   external paths are never automatically activated or copied: selecting preferences reset
   to target defaults, and every path-bearing owner provides an inert/unavailable
   representation or an explicitly degraded row policy.
5. **Dangerous capabilities reset.** Restored command/network integrations are disabled
   until target-side confirmation. Archive restore is not permission to execute MCP
   commands or auto-start agents/channels.
6. **No copy fallback this release.** Symlink/special-file managed roots and
   cross-filesystem (`EXDEV`) resource installs fail *before* mutation with an actionable
   error.
7. **Snapshot-time vs staging-time failure differ.** A managed payload already missing at
   snapshot time produces an explicitly *degraded* archive (export still allowed); a
   payload that drifts *during* staging fails export closed.
8. **Preparation is unarmed.** Restore preparation is cancellable and grants no
   permission to promote; only explicit relaunch confirmation arms promotion.
9. **Completed asides block deletion until acknowledgement.** A completed restore's DB and
   resource asides block permanent orphan deletion until the user acknowledges.

---

## 2. Product Contract

### 2.1 Lite — database replacement, target filesystem preserved

Lite backs up and restores one complete portable database and carries **no resource
bytes**. Restore replaces the database and leaves every target filesystem root untouched.

Consequences that MUST be surfaced to the user and honored by code:

- On the same profile, resource paths referenced by the restored DB often still exist and
  remain usable.
- On a new device, attachments, Knowledge sources, local/ZIP Skills, Notes bodies,
  workspaces, and other resource-backed content may be unavailable.
- Target authoritative resource files no longer referenced by the restored DB remain
  physically present. Promotion never creates, replaces, or deletes authoritative resource
  files.
- Two disclosed exceptions are **not** archive resource restoration: registered path APIs
  may auto-create empty managed root directories (`shouldAutoEnsure`, see
  [paths/README](../../../src/main/core/paths/README.md)); and after boot, feature owners
  may rebuild disposable derived files (e.g. Knowledge `{baseId}/.cherry/index.sqlite`) for
  existing resource directories.
- Lite is a database backup/restore, **not** a cross-device migration.

**Resource coverage inventory.** Lite reports *existence coverage* before relaunch —
each requirement classified as `available`, `missing`, `external-unverifiable`, or
`rebuildable`. It deliberately does not hash large target resources or claim content
equality; it is diagnostic and never copies or mutates files to repair coverage.

### 2.2 Full — fixed resource overlay

Full carries the same database plus every portable resource payload its manifest
declares. Restore replaces the database and installs the resources through a single fixed
state machine ([§6](#6-journal-v2--promotion)). There is **no** configurable merge, no
`SKIP/OVERWRITE/RENAME/FIELD_MERGE` selection, and no database identity map.

Accepted tradeoff: Full does not produce an exact filesystem snapshot when the target
holds extra paths — target-only files are kept, by product decision.

### 2.3 What "Full" includes and excludes

| Included (transported + restored) | Excluded / marked unavailable |
|---|---|
| Internal file blobs and authoritative file relationships | `external.*` files and absolute user paths |
| Knowledge raw/source content (derived indexes rebuilt) | BootConfig and target-device startup choices |
| Paintings and their internal file closure | Caches, logs, model/toolchain downloads, temp data |
| Managed Notes bodies | Rebuildable FTS/Knowledge indexes |
| Local/ZIP Skills when their directory is authoritative | Third-party package state that cannot relocate safely |
| Other Cherry-owned managed roots explicitly registered by the owning feature | |

"Full" means **recoverable portable closure**, not every file the app can read.

---

## 3. Portable Database Contract

Both presets export the **same** complete portable SQLite snapshot. It is portable, not a
byte-for-byte live image.

**Snapshot mechanism.** Produced via `DbService.createSnapshot()` →
`snapshotTo` (`VACUUM INTO`), never by copying the live file — WAL state makes a raw copy
unsafe. (`src/main/data/db/DbService.ts:256`,
`src/main/data/db/restore/snapshot.ts`.)

Portability is achieved by deterministic **materialization** while staging the restore DB.
Materialization is archive processing, not row merge: it never consults target business
rows and never combines two identities.

### 3.1 Sanitation & materialization policy

| Concern | Policy |
|---|---|
| Business data + migration/seed bootstrap | **Preserve.** Retain the exact migration/seed state required to migrate and boot; retain `app_state` keys required by v2 migration/seeding rather than dropping the table. |
| Runtime work proven unsafe to restore (e.g. pending job executions) | **Reset.** Remove per an explicit, tested allow/reset list — the Preference schema has no metadata to discover this automatically, so the list is backup-owned and enumerated by tracing actual readers on the implementation-time `origin/main` schema. |
| Device/platform-local preference keys | **Reset** to target defaults, from an explicit backup-owned list. |
| Managed absolute paths under producer roots (`note.rootPath`, managed `agent_workspace.path`, managed paths in structured data) | **Rebase** deterministically onto target roots resolved through `application.getPath()`, using producer managed-root identities recorded in the manifest. |
| Archive-supplied external absolute paths | **Never auto-activate.** Reset selecting preferences to target defaults; retain the path only as inert metadata when its owner proves no automatic I/O can follow it, otherwise convert/drop the path-bearing derived/reference row under an explicit degradation policy. |
| Dangerous capabilities — MCP `command`/`dxtPath`/`isActive`/trust state, agent/channel automation, future active/trusted rows | **Reset** so nothing executes a command, opens an external path, or initiates a network side effect without fresh target-side confirmation. |
| Derived indexes | **Rebuild** after staging/restore where cheaper and safer than transporting runtime state. |

**Invariant:** managed-path rebasing and runtime-key sanitation are deterministic archive
materialization, never a row merge. A byte-equivalent business DB payload MUST result for
the same source snapshot under both presets.

---

## 4. Path & Filesystem Policy

All filesystem access goes through the path registry
([paths/README](../../../src/main/core/paths/README.md)). The registry's ownership scopes
are the trust boundary for restore:

| Scope | Meaning for restore |
|---|---|
| `feature.*` | Cherry-owned; a valid overlay target; may be created/managed/deleted. |
| `external.*` | Third-party owned; **never** an overlay target — never create, follow, or overwrite. Report unsupported/unavailable. |

**Rejected before any mutation** (fail closed, actionable error, no copy fallback in this
release):

- Symlink / special-file managed roots (validated via `lstat`/`realpath` on every existing
  ancestor).
- Cross-device (`EXDEV`) installs — same-filesystem rename eligibility is required.
- Journal entries whose live paths are not pairwise distinct, or where one live path is an
  ancestor of another.

Registered-root containment, pairwise-distinctness, non-overlap, and same-filesystem
eligibility are enforced **twice** — at archive admission and again at journal sealing —
so resource order is irrelevant and admission is the trust boundary ([§5](#5-archive--manifest-v2)).

---

## 5. Archive & Manifest v2

The v2 manifest is a **material semantic break** from the current format-1 manifest and
takes a new, incompatible backup format version. When the development migration chain is
reset before release ([CLAUDE.md → v2 Refactoring](../../../CLAUDE.md)), the format is
bumped incompatibly rather than accepting archives whose chain identity can no longer be
interpreted.

### 5.1 Manifest contents

| Field group | Records |
|---|---|
| Preset | `preset: 'lite' \| 'full'` |
| Producer diagnostics | Format + producer version, producer **platform**, and **managed-root identities** needed for deterministic rebasing |
| Migration identity | The **complete** source migration chain, not just its tip |
| DB payload | Hash + size of the portable DB payload |
| Resource requirements | Existence-oriented requirement inventory (both presets) |
| Resource payloads (Full) | Included payload inventory + cryptographic hashes |
| Directory-unit hash spec | Canonical: sorted relative regular-file paths + content, excluding only explicitly derived paths |
| Exclusions/degradations | Explicit product-allowed exclusions and degraded sections |

Archives contain **plaintext credentials**. Output mode `0600` protects local permissions
only; export and restore UI MUST warn that copied archives expose API keys.

### 5.2 Admission — rejected before journal creation

Admission is the trust boundary; all of the following fail **before** any journal or live
write:

- Path escapes, dot segments, duplicate names, undeclared payloads.
- Archive entries marked as symlinks/special files *before* extraction, plus staged-tree
  `lstat`/`realpath` escapes *after* extraction.
- Entry count, uncompressed size, compression ratio, or per-entry limit violations.
- Hash/size mismatch.
- Incompatible format, or a migration chain **ahead of** / **forked from** the app's chain.
- Corrupt SQLite or an invalid staged migration result.

A valid **older-chain** staged DB migrates forward and passes integrity checks (it is not
rejected). A **downgraded binary** reading a v2 journal fails safely through strict-version
quarantine without touching live data (the journal schema is a `strictObject` with a
literal version — an unrecognized version parses as corrupt, so the gate cleans up rather
than misinterpreting; see `RestoreJournalSchema`).

### 5.3 Frozen operating ceilings

Bounded ceilings are frozen in the format contract and shared by preflight and admission
(same constants): maximum archive entries, resource-install entries, path depth/length,
per-entry and total uncompressed bytes, compression ratio, and staging disk headroom.

- Large-file/directory staging checks cancellation incrementally.
- Resource-install `fsync`s affected parent directories in **bounded batches** before the
  global step marker — not once per entry — so preboot install time is bounded by affected
  directories, not entry count. A ceiling fixture proves this bound; a recorded,
  non-gating benchmark documents expected preboot time (no flaky wall-clock CI assertion).

### 5.4 Source-drift detection (export staging)

- **Files:** source-handle pre/post metadata compared while streaming to the staged hash.
- **Directories:** a deterministic initial tree manifest, per-file pre/post checks, and a
  final tree rescan.
- Cancellation is checked per chunk/file. Any drift or disk-full removes only
  operation-owned staging output.

A payload already missing at snapshot time → explicit `degraded` manifest section (export
allowed). A payload that changes, disappears, escapes its registered root, or cannot be
verified *while staging* → export fails closed, because the archive cannot prove which
version it captured. A degraded Full archive is never presented as complete recovery.

---

## 6. Journal v2 & Promotion

Runtime never writes restored rows into the live DB. It stages and seals the archive DB,
then writes a journal-v2 state machine. Journal primitives, durability invariants, and the
promotion gate live in
[`src/main/data/db/restore/`](../../../src/main/data/db/restore/README.md) and
[`src/main/core/preboot/backupRestoreGate.ts`](../../../src/main/core/preboot/backupRestoreGate.ts).

### 6.1 Lifecycle states

```text
prepared → armed → promoting → completed | failed | expired
```

| State | Meaning |
|---|---|
| `prepared` | Staged and sealed. **Not** permission to restore — UI can cancel it and clean its staging tree. |
| `armed` | Durably written *immediately before* `application.relaunch()` on explicit user confirmation. If relaunch initiation fails, the service clears the arm and reports failure. |
| `promoting` | Preboot is executing; `step` is the durable last-completed global-step marker (compare via `indexOf` on the step-order table, never lexicographically). |
| `completed` | New DB (and, for Full, all resources) live. Asides retained until acknowledgement. |
| `failed` | Crash rollback or integrity failure; old DB is live. |
| `expired` | An **unarmed** `prepared` journal an unrelated restart found; cleaned rather than promoted. |

Only `armed` enters promotion. Once armed, later local DB writes are intentionally
replaced.

> **Change from current `origin/main`.** Journal v1 (on main) uses states
> `staged → promoting → completed|failed|expired` with no `prepared`/`armed` split and a
> live **fingerprint** captured under renderer write-quiesce. v2 removes the fingerprint
> and the quiesce, adds the `prepared`/`armed` split, and adds the unified
> `resource-install` operation. Chain compatibility still guards against binary changes
> between staging and boot. See [§10 Provenance](#10-provenance).

### 6.2 Live WAL checkpoint is mandatory

Removing fingerprint comparison MUST NOT remove the data-preservation step: in the
zero-connection preboot window, **checkpoint-truncate the current live DB** before removing
sidecars or moving it aside (`DbService.checkpointTruncate()` →
`checkpointTruncateAssert`, `src/main/data/db/DbService.ts:270`). A dirty-WAL fixture must
prove the aside contains the latest committed live transactions before replacement.

### 6.3 Full resource-install operation

Every Full payload is one journal-v2 `resource-install` operation carrying: a resource type
(`file` or `directory`), a staged path, a registered live path, and a reserved
restore-specific aside path. Full promotion installs all declared resources **before** the
DB commit boundary, then moves the checkpointed live DB aside and promotes the staged DB.

Install action by target state at preboot execution:

| Target state | Action |
|---|---|
| Declared live path absent | Rename staged resource into live path. |
| Declared live path present | Rename target to aside, then rename staged resource into live path. |
| Target-only path not declared by archive | Leave untouched (absent from journal). |
| External/user-owned path | Never create a journal entry; report unsupported/unavailable. |

There is intentionally **no** target-side hash / no-op branch: reinstalling identical
content costs I/O but removes target hashing and staging-to-boot classification drift.
Archive payload hashes protect archive integrity; they do not participate in target
conflict policy.

### 6.4 Crash-recovery transition table

The install is crash-idempotent from the journal's durable **recovery
direction / last-completed global step** *plus* the `(staged, live, aside)` existence
state. Existence alone is insufficient — `(present, absent, present)` is ambiguous.

| direction / step | staged | live | aside | Interpretation → Action |
|---|---|---|---|---|
| pre-commit | present | absent | absent | Target was absent and install has not landed → **rollback**: discard staged; leave live absent. |
| pre-commit | present | present | absent | Target present, install next → **rollback** (pre-commit always rolls back): leave target; discard staged. |
| pre-commit | present | absent | present | **Ambiguous** — "target parked, install next" vs "backup removed during rollback, restore aside next". Pre-commit selects **rollback**: rename aside→live, discard staged. |
| pre-commit | absent | present | present | Backup already moved into live during a prior forward step → **rollback**: move live→staged (or discard), restore aside→live. |
| pre-commit | absent | present | absent | Install completed for this unit but pre-commit overall → **rollback** the unit recursively: move installed backup out of live, restore aside when present. |
| committed | present | absent | present | Committed branch, target parked, install pending → **forward**: rename staged→live. |
| committed | absent | present | present | Committed, installed, aside retained for GC → **forward-complete**: keep live, retain aside until acknowledgement. |
| committed | absent | present | absent | Fully installed, no aside (target was absent) → **forward-complete**: done. |

- Pre-commit recovery selects rollback; committed recovery selects forward/revert per the
  persisted global step and the DB commit-point probe.
- Rollback moves an installed backup resource back out of `live`, restores `aside` when
  present, and is **recursive-safe** for directory units.
- A crash before the resource-install step marker may roll back already-installed entries
  rather than resume them; a crash at/after the DB commit follows the committed branch.
- Target-only paths are absent from the journal and untouched throughout.

The table MUST be **total** over every reachable `(direction/step, staged, live, aside)`
state and must reject overlapping/symlink/EXDEV states before mutation.

### 6.5 Completed-restore GC protection & acknowledgement

While a completed restore's DB/resource asides are retained, orphan sweep must **abort or
quarantine** instead of permanently unlinking anything based on the newly restored DB —
`orphanSweep` already stands aside on `hasPendingRestore()`
(`src/main/services/file/internal/orphanSweep.ts:126`); the guard is extended to cover
`prepared`, `armed`, `promoting`, and completed-but-unacknowledged recovery.

**Acknowledgement is the commit-to-keep action.** Cleanup idempotently removes recovery
asides **first**, clears the journal **last**, then releases GC protection. A crash
anywhere before the last step leaves protection active and cleanup resumable. This is crash
rollback protection, not a hidden long-term undo feature.

### 6.6 userData relocation

`runUserDataRelocation()` executes before the restore gate and copies the entire userData
tree ([userDataLocation.ts](../../../src/main/core/preboot/userDataLocation.ts)). All
journal/staging/aside paths are therefore stored **userData-relative** and resolved against
the currently resolved userData. An integration test must prove that a `prepared`/`armed`
restore survives relocation and promotes only under the relocated tree.

### 6.7 Post-promotion derived work

Post-promotion filesystem-derived work is **not** a staged-DB adapter hook. A tracked
Knowledge reindex is scheduled from lifecycle `onAllReady` after any successful promotion
whose restored DB contains Knowledge rows: Lite queues only bases with existing managed
resource directories; Full queues installed/existing bases from the durable restore
summary. The background Promise is tracked and joined/cancelled from `onStop` per lifecycle
rules. Export and directory payload hashing exclude only
`{baseId}/.cherry/index.sqlite{,-wal,-shm}`.

---

## 7. Resource Ownership (Adapters)

A **private, static** resource-adapter list lives inside the backup service module for
known out-of-database content:

```ts
interface BackupResourceAdapter {
  readonly kind: BackupResourceKind
  collectRequirements(ctx: SnapshotReadContext): readonly ResourceRequirement[]
  stageResources(ctx: FullResourceStageContext): Promise<readonly StagedResource[]>
}

const RESOURCE_ADAPTERS: readonly BackupResourceAdapter[] = [/* known resource owners */]
```

This is **not** a public extension point, `ContributorManager`, or cross-feature registry.
`origin/main` has no `src/main/data/db/backup` boundary, and backup resource orchestration
is business behavior, not data-layer storage — so the type and adapters stay private under
`src/main/services/backup/resources/`. Add an adapter only when a real authoritative
resource exists; a domain with no external resources has no adapter (no schema-only
shells).

An adapter may call a feature's **existing public** read/snapshot capability; if no safe
capability exists, flag the upstream owner API — never deep-import feature internals or
invent a generic contributor framework. Feature modules must not depend upward on
`BackupService`.

**Resource unit by ownership:**

| Content | Unit |
|---|---|
| Immutable/internal file blob | Individual file |
| Knowledge Base | `{baseId}` directory as one unit; exclude/rebuild derived index |
| Local/ZIP Skill | Skill directory as one unit |
| Notes | Managed markdown file/tree entries; external Notes roots never automatic targets |
| Agent/MCP managed directories | Only after their owner declares a registered safe root and archive contract |

A directory resource installs as a unit; recursively overlaying two Knowledge/Skill
directories would create an unvalidated mixed resource and is forbidden.

**No adapter field** carries any merge fact: no table ownership, primary-key identity
class, aggregates/members, conflict defaults, unique merge rules, DB FK/reference actions,
or clone/remap/transform hooks. Merge facts do not exist in v2.

---

## 8. User-Visible Scope

**Export UI:**

- **Lite:** "Database only. Restore does not replace your local files; resource-backed
  content may be unavailable, and normal cleanup may later reclaim files no longer
  referenced by the restored database."
- **Full:** "Database plus portable managed files. Restore does not delete target-only
  paths; normal cleanup may later reclaim unreferenced managed blobs."
- **Both:** warn about plaintext credentials, and that restored executable/network
  integrations are disabled until re-confirmed on the target device.

**Restore preview:**

- Archive preset and database version.
- Lite: resource coverage on this device — available / missing / external-unverifiable /
  rebuildable counts, with **no** content-equality claim.
- Full: a current estimate of resources to install or replace, plus unsupported external
  resources; the preboot state machine owns the final result.
- Destructive fact: the current database is replaced and the app restarts.

No merge, skipped-record, field-conflict, or domain-conflict language appears anywhere in
the UI.

---

## 9. Phase Ownership & Security Boundaries

| Phase | Owns |
|---|---|
| 0 (this doc) | The frozen contract and defaults ([§1](#1-approved-defaults-frozen)); no product code. |
| 1 | Manifest v2, portable DB sanitizer/materializer + managed-root rebasing, journal-v2 states + `resource-install` transition table, secure archive assembly/admission, ceilings, source-drift protocol. Proved by focused tests before UI. |
| 2 | Lite DB-only export/prepare/arm/preboot replacement; lifecycle-owned `BackupService`; live WAL checkpoint; GC protection + acknowledgement; existence inventory. |
| 3 | Full resource capture + unified file/directory installation with crash matrices; durable restore summary feeding the reindex scheduler. |
| 4 | Narrow IpcApi routes/events over the Phase-2 service; Full/Lite export & restore UI; merge copy/types removed; i18n + breaking-change docs. |
| 5 | End-to-end proof, adversarial review, repository gates, replacement PR targeting `main`. |

**Security boundaries:**

- **Archive admission** ([§5.2](#52-admission--rejected-before-journal-creation)) is the
  single trust boundary — nothing untrusted reaches a journal or live write before it
  passes.
- **IpcApi handlers** stay thin: sender policy (managed-window sender required for
  destructive commands), schema validation, `IpcError` mapping, and delegation to
  `BackupService`. See [IPC Reference](../ipc/README.md).
- **Path scopes** ([§4](#4-path--filesystem-policy)) gate every filesystem effect:
  `feature.*` targets only, `external.*` never mutated.
- **Capability reset** ([§3.1](#31-sanitation--materialization-policy)) ensures a restored
  archive cannot execute commands or initiate network/filesystem side effects without fresh
  target-side confirmation.

---

## 10. Provenance

The implementation baseline is the latest fetched `origin/main` (reviewed at
`09cb39032b`), **not** the #17206 branch. PR #17206 and PR #12659 are design/implementation
evidence of *what* the system must do, never ancestry to inherit.

**Already on `origin/main` — reused in place** (do not reimplement):

| Primitive | Location |
|---|---|
| `DbService.createSnapshot()` / `checkpointTruncate()` | `src/main/data/db/DbService.ts:256`, `:270` |
| `snapshotTo` (`VACUUM INTO`), `checkpointTruncateAssert`, `hashDbFile`, `readAppliedChain` | `src/main/data/db/restore/{snapshot,checkpoint,hashDbFile,appliedChain}.ts` |
| Restore journal fsync primitives, promotion step/commit probing, crash recovery, `markRestoreFailedAfterCrash`, `isLiveDbStranded`, `runRestorePromotion` | `src/main/data/db/restore/{restoreJournal,restorePromotion}.ts` |
| Preboot restore gate | `src/main/core/preboot/backupRestoreGate.ts` |
| Path registry / containment rules (`feature.backup.*` keys) | `src/main/core/paths/pathRegistry.ts` |
| Orphan sweep + its `hasPendingRestore()` stand-aside guard | `src/main/services/file/internal/orphanSweep.ts` |
| Preboot userData relocation (runs before the restore gate) | `src/main/core/preboot/userDataLocation.ts` |
| v1 whole-store replacement semantics (evidence only) | `src/main/services/LegacyBackupManager.ts` |

**Selectively ported from #17206 after removing all merge assumptions** (these do **not**
exist on `origin/main` today — do not claim otherwise): ZIP assembly, atomic `0600`
no-clobber publication, disk preflight, cancellation, staging cleanup; archive admission
limits and path/name checks; chain classification/migrate-forward; request/status/error
shapes, IPC schemas, UI state machines, low-level file staging, and Knowledge reindex
scheduling (`enqueueRestoredKnowledgeReindex`).

**Genuinely new — proved by focused tests before UI:** manifest v2 with
complete-chain/payload integrity; portable DB sanitizer/materializer and active-capability
reset; journal-v2 `prepared`/`armed` states and unified file/directory resource-install;
source-drift detection, Lite existence inventory, path-overlap/same-filesystem enforcement,
completed-restore GC protection, and acknowledgement cleanup.

**Explicitly excluded — do NOT port and do NOT reintroduce:**

- `MergeEngine` and the merge helper directory.
- 10/14-domain Lite stripping and `SqliteBackupStripper` domain-deletion logic.
- `resourcePlanning` local-record skip semantics.
- Identity propagation, dangling-reference repair, and DB-merge conflict/degradation
  contracts.
- Restore-time live snapshot, renderer write-quiesce, and DB fingerprint expiry — replaced
  by the mandatory live preboot WAL checkpoint ([§6.2](#62-live-wal-checkpoint-is-mandatory)).
- Any incremental backup, cross-database merge, domain stripping, or public contributor
  framework.

The replacement PR targets `main` and its description explicitly supersedes #17206's
selective-domain merge contract.
