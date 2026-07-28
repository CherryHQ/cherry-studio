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
2. **Full installs only the authoritative closure.** After materializing the staged DB,
   restore recomputes its resource requirements and requires exact
   `(kind, resourceType, livePath)` agreement with the manifest. Full installs only
   payloads authorized by that closure. An existing target is moved aside first;
   target-only paths outside declared directory units remain untouched.
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
8. **Preparation is unarmed and identity-bound.** Restore preparation is cancellable and grants no
   permission to promote; explicit relaunch confirmation carries the preview's `restoreId`, and main
   arms only that exact still-prepared journal.
9. **The displaced side blocks deletion until acknowledgement.** A completed restore may
   explicitly roll back to its retained DB/resources; after either direction finishes, the
   displaced side blocks permanent orphan deletion until the user acknowledges.

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

Full carries the same database plus its portable resource payloads. Restore materializes
that database, recomputes its authoritative resource closure, and rejects the archive unless
its requirement set agrees exactly; every payload must be a member of that set and each kind
is bound to one registered root. It then replaces the database and installs the authorized
resources through a single fixed state machine ([§6](#6-journal-v2--promotion)). There is **no** configurable merge, no
`SKIP/OVERWRITE/RENAME/FIELD_MERGE` selection, and no database identity map.

Accepted tradeoff: Full does not produce an exact filesystem snapshot when the target
holds extra paths — target-only files are kept, by product decision.

### 2.3 What "Full" includes and excludes

| Included (transported + restored) | Excluded / marked unavailable |
|---|---|
| Internal file blobs and authoritative file relationships | `external.*` files and absolute user paths |
| Knowledge raw/source content (derived indexes rebuilt) | BootConfig and target-device startup choices |
| Paintings and their internal file closure | Caches, logs, model/toolchain downloads, temp data |
| Managed Notes bodies, including roots with zero sparse `note` state rows | Rebuildable FTS/Knowledge indexes |
| Agent identity (`SOUL.md`, `USER.md`), memory, and system workspaces | User-selected external workspaces |
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

Pairwise-distinctness and non-overlap are enforced at archive admission. After DB
materialization, restore additionally requires exact agreement between the manifest and the
DB-derived requirement closure, binds each resource kind to its one registered root, and
rechecks containment, target type, ancestor safety, and same-filesystem eligibility while
sealing the journal. Resource order is irrelevant; no archive path becomes an install target
merely because it falls somewhere under a Cherry-owned root.

---

## 5. Archive & Manifest v2

The v2 manifest is a **material semantic break** from the current format-1 manifest and
takes a new, incompatible backup format version. When the development migration chain is
reset before release ([CLAUDE.md → v2 Refactoring](../../../CLAUDE.md)), the format is
bumped incompatibly rather than accepting archives whose chain identity can no longer be
interpreted.

### 5.1 Archive layout

A published archive is a single ZIP named `<name>.cherrybackup`, mode `0600`
(`src/main/services/backup/archiveLayout.ts`):

```text
<name>.cherrybackup            (zip, level 1, zip64)
├── manifest.json              (strict ManifestV2, at root)
├── backup.sqlite              (portable DB snapshot)
└── resources/<payload…>       (Full only; each payload's manifest archivePath is under here)
```

Lite carries `manifest.json` + `backup.sqlite` only. Publication is **atomic** and
strictly **no-clobber**: the producer writes into an operation-owned `mkdtemp`
directory beside the destination (same filesystem) and commits with a single
`link()`. It never overwrites or deletes a pre-existing sibling or destination,
and it only ever removes its own temp tree. When a volume cannot hard-link
(exFAT / some network mounts) publication **fails closed** with a typed
`HardLinkUnsupportedError` — there is deliberately **no** `copyFile` fallback
(Node documents `copyFile` as non-atomic), so the frozen atomic contract holds
and no visible partial archive is ever produced. Before writing, the producer
verifies the DB payload is a regular file whose size and SHA-256 match the
manifest. For Full, it also proves exact staged-resource inventory agreement:
every actual file/directory is covered by one non-overlapping manifest unit, each
`archivePath` is derived from its `livePath`, and every unit's type, size, and
SHA-256 match the staged bytes. The producer does NOT run the disk preflight — the export
orchestrator (Phase 2) sizes the whole export and calls `assertDiskHeadroom`
before staging; a mid-write `ENOSPC` is the producer's `DiskFullError` backstop.

### 5.1.1 Manifest contents

| Field group | Records |
|---|---|
| Preset | `preset: 'lite' \| 'full'` |
| Producer diagnostics | Format + producer version, producer **platform**, and **managed-root identities** needed for deterministic rebasing |
| Migration identity | The **complete** source migration chain, not just its tip |
| DB payload | Hash + size of the portable DB payload |
| Resource requirements | Existence-oriented requirement inventory (both presets) |
| Resource payloads (Full) | Included payload inventory + cryptographic hashes |
| Directory-unit hash spec | See §5.1.2 |
| Exclusions/degradations | Explicit product-allowed exclusions and degraded sections |

All cryptographic hashes are **SHA-256, 64 lowercase hex** (the `hashDbFile`
representation). Archives contain **plaintext credentials**. Output mode `0600`
protects local permissions only; export and restore UI MUST warn that copied
archives expose API keys.

### 5.1.2 Canonical directory-unit hash

A directory payload (a Knowledge base, a Skill, a Notes tree) is content-addressed
by one SHA-256 (`hashDirectoryUnit`). The producer (over the staged tree) and
admission (over the extracted tree) compute the identical digest via one shared
scanner (`dirScan.ts`), so they can never disagree on membership or order:

- the unit's **regular files only** — symlink/special nodes and a symlinked root
  are rejected; **every** relative path (files *and* directories) must pass the
  Phase-1a portable-path rules and share ONE case/NFC-collision namespace (so an
  empty directory with a reserved/overlong/colliding name is rejected too); the
  shared per-entry / total-byte / path depth+length ceilings and an **entry count
  that includes directory entries** apply during the scan;
- files sorted by their POSIX relative path (UTF-8 byte order);
- each file framed **unambiguously** and concatenated into the digest as
  `u64be(len(relPath)) ‖ relPath ‖ u64be(byteLen(content)) ‖ content`, where
  `u64be` is an 8-byte big-endian length — the length prefixes make it impossible
  to shift a path/content boundary to forge a colliding tree.

Node metadata identity uses **bigint** stat (`dev`/`ino`/`size`/`mtimeNs`/`ctimeNs`)
so a same-size fast rewrite or a metadata-only change is observable to a re-scan.

**Knowledge derived-index exclusion is opt-in and root-exact.** Only the Knowledge
adapter's `excludeKnowledgeDerivedIndex` option drops artifacts, and it matches
**only** the exact unit-root paths `.cherry/index.sqlite`, `.cherry/index.sqlite-wal`,
`.cherry/index.sqlite-shm` (a Knowledge unit is one `{baseId}` directory, §6.7).
It defaults to **off**; a nested `sub/.cherry/index.sqlite` or any `.cherry`
content in a Skills/Notes unit is authoritative and never dropped.

### 5.2 Admission — rejected before journal creation

Admission is the trust boundary; all of the following fail **before** any journal or live
write:

- Path escapes, dot segments, malformed UTF-16 (lone surrogates), duplicate names, undeclared payloads.
- Archive entries marked as symlinks/special files *before* extraction, plus staged-tree
  `lstat`/`realpath` escapes *after* extraction.
- Entry count, uncompressed size, compression ratio, or per-entry limit violations.
- Hash/size mismatch.
- Incompatible format, or a migration chain **ahead of** / **forked from** the app's chain.
- Corrupt SQLite or an invalid staged migration result.
- A manifest requirement set that differs from the materialized DB's authoritative closure,
  a payload absent from that closure, a payload kind aimed at another kind's root, or a
  missing Full payload without its exact disclosed resource degradation.

The ZIP catalog preserves every central-directory record instead of using a name-keyed
map, so duplicate entries cannot hide one another. Central-directory sizes and compression
ratios are advisory gates only: extraction streams each regular entry into an exclusively
created file and proves actual bytes equal the declared size while enforcing shared
per-entry and cumulative actual-byte budgets. Extraction occurs only under an
identity-tracked, operation-owned staging root after disk preflight; cancellation and
failure clean that root without touching siblings.

A valid **older-chain** staged DB migrates forward with the production migrations and
passes integrity checks (it is not rejected). The staged DB's actual complete chain must
first equal the manifest chain, which must be an exact prefix of the bundled chain. After
migration, admission checkpoint-seals the DB into one main file, requires both WAL/SHM
sidecars to be absent, and returns final hash/size/chain separately from the unchanged
original manifest. A **downgraded binary** reading a v2 journal fails safely through strict-version
quarantine without touching live data (the journal schema is a `strictObject` with a
literal version — an unrecognized version parses as corrupt, so the gate cleans up rather
than misinterpreting; see `RestoreJournalSchema`).

**Quarantine has one exception: a stranded live slot.** An unreadable journal beside a
**missing** live DB while a park slot still exists means the crash landed after the live DB
was parked and the journal can no longer name what it parked. Quarantining there would clear
the last record of the restore and let the boot create a fresh **empty** DB beside the
user's real one, so the gate refuses to boot instead, leaving every artifact where a repair
needs it (the park slot is found by the naming contract in `dbAsideRelPathV2`/`findDbAside`,
which is why that name may not drift). With no park slot there is nothing to strand —
refusing would only wedge an app whose data is already gone — so quarantine proceeds.

### 5.3 Frozen operating ceilings

Bounded ceilings are frozen in the format contract and shared by preflight and admission
(same constants): maximum archive entries, resource-install entries, path depth/length,
per-entry and total uncompressed bytes, compression ratio, and staging disk headroom.

- Large-file/directory staging checks cancellation incrementally.
- **The manifest byte cap must cover the resource-install ceiling.** `manifest.json` carries
  the requirement inventory and (for Full) the payload inventory, so its size scales with the
  profile, and the pre-parse cap is the only bound on those arrays. The two ceilings are
  therefore not independent: at the frozen 50,000 resource-install entries a manifest measures
  ~14 MiB of payloads plus ~5 MiB of requirements. A cap below that makes an archive at the
  install ceiling **unproducible and unadmissible** — the ceilings would contradict each
  other. `maxManifestBytes` is 32 MiB for exactly this reason, and a test builds a manifest at
  the install ceiling to prove the two constants still agree.
- Before `prepared` is written, restore `fsync`s every staged DB/resource file, then all
  staging directories bottom-up and the staging parent's entry. A durable journal therefore
  never names payload bytes that a power loss can discard.
- Resource-install `fsync`s affected parent directories in **bounded batches** before the
  global step marker — including the parents whose entries create a new
  `restore-aside/<restoreId>` tree — not once per entry. A ceiling fixture proves this bound;
  a recorded, non-gating benchmark documents expected preboot time.

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
prepared → armed → promoting → completed → rollback-armed → reverting → rolled-back
                         ├───────→ reverting → failed
                         └───────→ failed | expired
```

| State | Meaning |
|---|---|
| `prepared` | Staged and sealed. **Not** permission to restore — UI can cancel it and clean its staging tree. |
| `armed` | Durably written *immediately before* `application.relaunch()` on explicit user confirmation. If relaunch initiation fails, the service clears the arm and reports failure. |
| `promoting` | Preboot is executing; `step` is the durable last-completed global-step marker (compare via `indexOf` on the step-order table, never lexicographically). If either recovery direction cannot converge, this active marker remains and normal boot is refused. |
| `reverting` | A failure after DB commit durably selected the reverse direction before any reverse move. Resources return first and the old DB last; a crash re-enters this state rather than misclassifying the old DB as a completed forward restore. |
| `completed` | New DB and every Full resource are live. Asides are retained until the user either acknowledges or explicitly requests rollback. |
| `rollback-armed` | Durably records explicit rollback consent immediately before relaunch. Preboot must finish the reverse move or fail fast; normal services may not open a mixed old/new state. |
| `rolled-back` | The pre-restore DB and replaced resources are live again. Displaced restored copies remain operation-owned until acknowledgement. |
| `failed` | Promotion rollback or integrity failure finished coherently; the old DB and original resources are live. |
| `expired` | An **unarmed** `prepared` journal an unrelated restart found; cleaned rather than promoted. |

Only `armed` enters promotion; only `rollback-armed` enters explicit reverse promotion.
Once either action is armed, later writes in the state being displaced are intentionally
replaced rather than merged.

Every state also carries the **degradation report** — what materializing this
archive against this device reduced (§4), aggregated per `(table, reason)`. It
lives in the journal rather than in memory because the report is shown after the
relaunch, once the staging tree that produced it is gone; without it a degraded
restore would present as a complete one. The producer **truncates** the list to
its cap instead of failing the write: a report detail must never be able to
quarantine an otherwise valid journal.

> **Change from current `origin/main`.** Journal v1 (on main) uses states
> `staged → promoting → completed|failed|expired` with no `prepared`/`armed` split and a
> live **fingerprint** captured under renderer write-quiesce. v2 removes the fingerprint
> and the quiesce, adds the `prepared`/`armed` split, and adds the unified
> `resource-install` operation. Chain compatibility still guards against binary changes
> between staging and boot. See [§10 Provenance](#10-provenance).

### 6.2 Live WAL checkpoint is mandatory

Removing fingerprint comparison MUST NOT remove the data-preservation step: in the
zero-connection preboot window, **checkpoint-truncate the current live DB** (`DbService.checkpointTruncate()`
→ `checkpointTruncateAssert`, `src/main/data/db/DbService.ts:270`). This is the **first**
effectful step (`live-checkpointed`), before any resource install, sidecar removal, or
DB move: a checkpoint failure therefore aborts the promotion with **zero resource
effects**. A dirty-WAL fixture must prove the aside contains the latest committed live
transactions before replacement.

### 6.3 Full resource-install operation

Every Full payload is one journal-v2 `resource-install` operation carrying: a resource type
(`file` or `directory`), a staged path, a registered live path, and a reserved
restore-specific aside path. Full promotion installs all declared resources **after the
live checkpoint (§6.2) but before** the DB commit boundary, then moves the checkpointed
live DB aside and promotes the staged DB. Within one entry the staging/live/aside paths are
pairwise distinct (and the DB `promote`/`aside` distinct) under the collision policy below.

Install action by target state at preboot execution:

| Target state | Action |
|---|---|
| Declared live path absent | Rename staged resource into live path. |
| Declared live path present, **same type** as the unit | Rename target to aside, then rename staged resource into live path. |
| Target-only path not declared by archive | Leave untouched (absent from journal). |
| External/user-owned path | Never create a journal entry; report unsupported/unavailable. |

**Type/kind mismatches fail closed before any mutation.** A rename install is admitted only
when the existing live node is absent, or a regular file/directory whose type **matches**
the unit's `resourceType`. A declared live path that is a symlink or special file, whose
existing type differs from the unit (file-over-directory or directory-over-file), or that
is reached through a symlink/special ancestor, is **rejected** at admission and journal
sealing (`validateResourcePaths`) — never overwritten — because replacing it would require
destroying the existing node and could delete target-only descendants, violating
preservation.

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
- **Both-source-and-live states fail closed.** Under rename-only install the backup lives
  in exactly one of `{staged, live}`, so `staged` and `live` both present is impossible —
  with one provable exception: pre-commit with `aside` **also** absent proves no parking
  happened, so `live` is the untouched original target and the plan simply drops `staged`.
  Every other `staged`+`live` state (pre-commit `SLA`, committed `SL-`/`SLA`) cannot prove
  whether `live` is an installed backup or a target-only file, so the recovery **aborts
  inconsistent** rather than overwrite or discard a possibly target-only node.

The table MUST be **total** over every reachable `(direction/step, staged, live, aside)`
state and must reject overlapping/symlink/EXDEV states before mutation.

**Explicit rollback reuses the same move-only triples.** It is available only from a
fully `completed` restore before acknowledgement. Resources reverse first in the
`pre-commit` direction; the DB moves last as the reverse commit boundary. The current
restored DB is parked in the operation-owned forensic slot, restored resources move back to
their staging slots, and the retained asides return to live. Crashes re-enter under the
durable `rollback-armed` direction. If any reverse move cannot converge, preboot fails fast
rather than open normal services on a mixed DB/resource state. There is no merge and no redo
chain.

**A post-commit reverse direction is durable before reverse mutation.** A failed integrity
check first writes `reverting`; only then may resources return and the old DB move back. If
any move or the final `failed` write is interrupted, preboot retries under `reverting` and
refuses normal startup until the old DB/resource state is coherent. The DB move is the
reverse commit boundary, so a crash after it can never be interpreted as forward success.

**The terminal state is durable before anything is deleted.** Every terminal outcome writes
the journal **first** and drops the staging tree **second**, and a terminal write that fails
keeps the tree (making the write retryable) instead of proceeding. The reverse order costs
data: with the tree gone under a still-`promoting` journal, every rolled-back unit sits at
pre-commit `-L-`, which the table above reads as an installed backup — so the next boot
would move the user's own files back out.

### 6.5 Restore rollback, GC protection & acknowledgement

While a completed or rolled-back restore retains the displaced side, orphan sweep must
**abort or
quarantine** instead of permanently unlinking anything based on the newly restored DB —
`orphanSweep` stands aside on `hasPendingRestore()`
(`src/main/services/file/internal/orphanSweep.ts`), which lives in
[`src/main/data/db/restore/restoreGuard.ts`](../../../src/main/data/db/restore/restoreGuard.ts)
and covers `prepared`, `armed`, `promoting`, `reverting`, `completed`,
`rollback-armed`, and `rolled-back` recovery.

**A completed restore presents exactly one reversible choice.** Before acknowledgement the
user may explicitly return to the immediately preceding DB/resource state. The rollback is
whole-state replacement, not merge: writes made after restore are retained only as displaced
artifacts until the rolled-back result is acknowledged, then released. It does not create a
long-term history or offer redo.

**Acknowledgement is the commit-to-keep action.** From `completed` it removes the previous
state; from `rolled-back` it removes the displaced restored state. Cleanup idempotently
removes operation-owned artifacts **first**, clears the journal **last**, then releases GC
protection. A crash before the last step leaves protection active and cleanup resumable.

**No newly executed path terminalizes an incomplete direction.** A blocked pre-commit
rollback remains `promoting`; a blocked post-commit reverse remains `reverting`; a blocked
committed install remains `promoting`. The gate fails the launch and retries before normal
services can open either database. The schema still accepts the older defensive
`failed.recoveryIncomplete` and `completed.resourcesIncomplete` markers so an interrupted
development build can be repaired rather than quarantined; those markers retain their asides,
refuse acknowledgement, and retry at boot, but current execution does not create them.

**The user must be asked, not waited on.** Because protection holds double storage and keeps
orphan sweep standing aside, an unacknowledged `completed` restore that is never revisited
would pay both costs forever. The main window therefore raises a persistent notice for the
terminal journal states at startup
([`useBackupRestoreNotice.ts`](../../../src/renderer/windows/main/hooks/useBackupRestoreNotice.ts)),
pointing at the settings screen that owns the action. Deliberately a reminder and **not** an
expiry: auto-acknowledging on a timer would delete the only rollback material a bad restore
has, unprompted, which is exactly the guarantee above.

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
| Orphan sweep | `src/main/services/file/internal/orphanSweep.ts` |
| Its `hasPendingRestore()` stand-aside guard (both journal versions) | `src/main/data/db/restore/restoreGuard.ts` |
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
