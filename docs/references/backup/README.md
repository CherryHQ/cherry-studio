# Backup & Restore Architecture (v2)

> **This document is the decision authority for Backup v2.** It freezes the approved
> product contract and the implementation mechanisms that satisfy it. Later phases and
> their tests are reviewed *against* this document; where code and this contract
> disagree, one of them is a defect. It is not a history of how the design was reached —
> [Provenance](#10-provenance) records only what later implementers must know about where
> code comes from.

Backup v2 replaces the selective-domain merge design (PR #17206) with a **whole-database
replacement** model that mirrors v1 semantics. One preset — **Full** — pairing one database
payload with a fixed resource overlay. It never merges database rows.

```text
Full result = (backup DB, target files overlaid with backup resources; target-only paths kept)
```

This is deliberately **not** a whole-profile rollback: Full preserves target-only paths
instead of deleting a managed root. See [§2 Product Contract](#2-product-contract).

> **One preset, on purpose.** A database-only "Lite" preset was specified and built, then
> cut before release: the product answer is that a backup carries everything it can. The
> manifest and the restore journal still record `preset`, pinned to `'full'`, so
> reintroducing a second preset is an additive change rather than a format break.

---

## 1. Approved Defaults (frozen)

These defaults are the contract. They are stated here without qualification; the rest of
the document elaborates the mechanisms that enforce them.

1. **Complete portable DB.** Every export carries the same complete portable SQLite
   snapshot. There is no 10/14-domain distinction and no domain stripping.
2. **Full installs only the authoritative closure.** After materializing the staged DB,
   restore recomputes its resource requirements and requires exact
   `(kind, resourceType, livePath)` agreement with the manifest. Full installs only
   payloads authorized by that closure. An existing target is moved aside first;
   target-only paths outside declared directory units remain untouched.
3. **Missing resources never block a restore.** Resources the archive could not carry, or
   that the target lacks, are *disclosed*, not a restore blocker.
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
7. **Seal-time capture defects degrade; post-seal drift fails.** A missing, wrong-typed, or
   uncapturable resource root is disclosed as a whole-unit degradation. Inside a capturable
   directory, external, dangling, cyclic, unreadable, and otherwise unclassified reference
   edges are omitted individually and disclosed; an internal link is materialized as ordinary
   archive bytes. Any source addition, deletion, replacement, content/metadata/tree change,
   portability violation, or ceiling violation observed after sealing aborts the entire
   export; no archive is published.
8. **Preparation is unarmed and identity-bound.** Restore preparation is cancellable and grants no
   permission to promote; explicit relaunch confirmation carries the preview's `restoreId`, and main
   arms only that exact still-prepared journal.
9. **The displaced side blocks deletion until acknowledgement.** A completed restore may
   explicitly roll back to its retained DB/resources; after either direction finishes, the
   displaced side blocks permanent orphan deletion until the user acknowledges.

---

## 2. Product Contract

### 2.1 Database replacement

An archive carries one complete portable database, and restore replaces the target
database with it — never a row merge.

Consequences that MUST be surfaced to the user and honored by code:

- Target authoritative resource files no longer referenced by the restored DB remain
  physically present. Promotion touches only the resource units the archive declares.
- Resources the archive could not carry (§4 degradations) may be unavailable on a device
  that does not already hold them.
- Two disclosed exceptions are **not** archive resource restoration: registered path APIs
  may auto-create empty managed root directories (`shouldAutoEnsure`, see
  [paths/README](../../../src/main/core/paths/README.md)); and after boot, feature owners
  may rebuild disposable derived files (e.g. Knowledge `{baseId}/.cherry/index.sqlite`) for
  existing resource directories.

**Resource coverage inventory.** Restore reports *existence coverage* before relaunch.
`available`, `rebuildable`, and `missing` **partition** the requirements — every
requirement lands in exactly one, and they sum to the requirement count. `rebuildable`
is the requirement whose payload carries only source material because its usable state
is derived and excluded, so the target's owner rebuilds it after restore (today: a
Knowledge base, which ships `raw/` without `.cherry/index.sqlite`, §6.7). The separate
`external-unverifiable` count is *not* part of that partition: it counts database
references that are not requirements at all (§4), so it can be non-zero with an empty
inventory. Coverage deliberately does not hash large target resources or claim content
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
| Agent identity (`SOUL.md`, `USER.md`), memory, and system workspaces | User-selected external workspaces (their *bytes*; a safe binding may survive per §3.1) |
| Built-in MCP workspace and profile-owned MCP memory graph | MCP OAuth, DXT/package state, and external MCP workspaces |
| Agent channel credentials/context tokens (restored inactive) | Target-device channel activation |
| Agent runtime `.claude` config, excluding its generated `skills/` mirror | Copilot safeStorage token |
| Local/ZIP Skills when their directory is authoritative | Third-party package state that cannot relocate safely |
| Other Cherry-owned managed roots explicitly registered by the owning feature | |

"Full" means **recoverable portable closure**, not every file the app can read.

---

## 3. Portable Database Contract

Every export carries the **same** complete portable SQLite snapshot. It is portable, not a
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
| Archive-supplied external absolute paths | **Never auto-activate.** Reset selecting preferences to target defaults; retain the path only as inert metadata when its owner proves no automatic I/O can follow it, otherwise convert/drop the path-bearing derived/reference row under an explicit degradation policy. `agent_workspace.path` is the one column that IS resolved automatically (the Agents page stats it on mount), so it earns its value through the three layers below rather than through inertness. |
| `agent_workspace.path` outside every producer managed root | **Three layers, automatic, no prompt** (`portability/workspacePathPolicy.ts`, `portability/materializeDatabase.ts`). **L1 — same-install attestation:** every export MACs its own final `manifest.json` bytes with a per-install secret (HMAC-SHA256, 32 random bytes at `feature.backup.attestation.key_file`, never inside an archive) and ships it as the optional `attestation.json` entry. If that MAC verifies against the local secret on restore, the archive was written by this very install about this very filesystem, and its external paths are kept **verbatim** — the ordinary "my own backup, same machine" restore, which the old binary policy broke. A missing entry or any verification failure is silently not-attested; it never fails a restore. **L2 — local-volume proof + existence probe:** for an unattested archive, a path must first pass string-only gates (producer platform = target platform; absolute; normalized; on win32 never UNC and the drive letter must equal this install's own drive; not inside any of this device's managed roots), and only then is it probed with a single `lstat` that must find a real directory. **L3 — disconnect:** anything else keeps the existing placeholder mechanism — a unique non-existent path under the target workspaces root — and the original string is parked in the nullable `agent_workspace.disconnected_path` column, which nothing resolves, so a future reconnect flow can offer the user their old location. Degradation reason: `workspace-disconnected`. |
| Dangerous capabilities — MCP `command`/`dxtPath`/`isActive`/trust state, agent/channel automation, future active/trusted rows | **Reset activation and trust state** so nothing executes a command, opens an external path, or initiates a network side effect without fresh target-side confirmation. Inert configuration is preserved; malformed executable fields fail closed, while malformed agent-channel `config` is reported but preserved behind `is_active = false` and revalidated on explicit activation. |
| Credentials | **Preserve as profile data, never activate automatically.** Archives already contain them in plaintext. Backup-destination auto-sync flags reset, and integration credentials are consumed only by explicit user actions. The API Gateway key is the exception: it authenticates a target-local listener and is regenerated. |
| Derived indexes | **Rebuild** after staging/restore where cheaper and safer than transporting runtime state. |

**Invariant:** managed-path rebasing and runtime-key sanitation are deterministic archive
materialization, never a row merge. A byte-equivalent business DB payload MUST result for
the same source snapshot.

`PORTABLE_DB_POLICIES` also carries a reviewed reference ledger for every path, URL,
workspace selector, and reference-bearing JSON surface the app may dereference. Each entry
declares one target-safe disposition — preserve inert, rebase, reset, deactivate, or drop —
and owner evidence for its unknown/malformed fallback. `schemaGuard.test.ts` binds that
ledger to the production Drizzle columns and fails if a reviewed surface loses its policy;
ordinary file bytes that no application reader interprets are not references and remain
ordinary capture content.

**Why the workspace layers are safe.** The threat an archive-supplied path poses is not the
path itself — it is what resolving one can do with no user action: a `\\server\share` value
makes Windows authenticate to an attacker-chosen host (machine-account credential leak), and
any value can address a volume this app has no business reading. Both are decided from the
string plus one trusted local anchor, with **no I/O**, and only a path that has already
passed them is ever `lstat`-ed (`lstat`, so the final component's symlink is not followed).
Attestation removes the question entirely for the common case: a verifying MAC proves the
path was written by this install about this filesystem, so keeping it grants no reach the
install did not already have. A refused path is not softened, only recorded: nothing resolves
`disconnected_path`, and the placeholder in `path` keeps the uniqueness/collision guarantees
of `disconnectAgentWorkspaces` untouched. Attestation failure is never an error the archive
can use to probe for the secret — it degrades silently to L2/L3. The secret is a per-install
artifact, not user data: Data Reset wipes it (`USER_DATA_WIPE`), so a reset install stops
recognizing its earlier archives and falls back to L2 — which still keeps every path that is
really there.

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
- Cross-device (`EXDEV`) installs — same-filesystem rename eligibility is required, proven for
  all three slots a unit renames between (staging, live, aside) at sealing AND again at preboot,
  for every unit before the first one moves.
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
├── attestation.json           (OPTIONAL: HMAC-SHA256 over manifest.json's bytes, §3.1 L1)
├── backup.sqlite              (portable DB snapshot)
└── resources/<payload…>       (each payload's manifest archivePath is under here)
```

An archive whose profile owns no resources has no `resources/` tree: it carries
`manifest.json` + `backup.sqlite`, plus optional `attestation.json`. A producer that
cannot mint its install secret omits the attestation, and admission treats an absent
or unverifiable entry as "not self-attested" rather than as a defect. The entry is
bounded to 4 KiB before extraction, carries no path or profile content, and is never
required to restore.

Before publication, the producer `fsync`s the temporary ZIP, reopens it, and applies
the same directory, duplicate-entry, size, and SHA-256 admission checks to the exact
archive bytes that will be published. Publication is **atomic** and strictly
**no-clobber**: the producer writes into an operation-owned `mkdtemp` directory beside
the destination (same filesystem) and commits with a single `link()`. It never
overwrites or deletes a pre-existing sibling or destination, and it only ever removes
its own temp tree. When a volume cannot hard-link
(exFAT / some network mounts) publication **fails closed** with a typed
`HardLinkUnsupportedError` — there is deliberately **no** `copyFile` fallback
(Node documents `copyFile` as non-atomic), so the frozen atomic contract holds
and no visible partial archive is ever produced. Before writing, the producer
verifies the DB payload is a regular file whose size and SHA-256 match the
manifest. It also proves exact staged-resource inventory agreement:
every actual file/directory is covered by one non-overlapping manifest unit, each
`archivePath` is derived from its `livePath`, and every unit's type, size, and
SHA-256 match the staged bytes. The producer does NOT run the disk preflight — the export
orchestrator (Phase 2) preflights the DB before snapshotting, scans the sealed
requirement set to size Full resources before their first copy, and preflights
the destination before archive publication. A mid-write `ENOSPC` remains the
producer's `DiskFullError` backstop for races after those checks.

Each export owns a `0700` profile staging tree and a destination-side publish tree. Both
carry an operation marker containing a random operation ID and their captured filesystem
identity. Startup cleanup removes a stale path only after verifying the matching marker,
nonce, expected parent containment, current `dev`/`ino`, and non-symlink ownership. It
never removes the final archive. A failure before `link()` leaves no final path; cleanup
failure after `link()` is cleanup debt and cannot turn a committed archive into a reported
failure.

### 5.1.1 Manifest contents

| Field group | Records |
|---|---|
| Preset | `preset: 'full'` — pinned to the only preset; any other value is refused |
| Producer diagnostics | Format + producer version, producer **platform**, optional packaged/development build type, and **managed-root identities** needed for deterministic rebasing |
| Migration identity | The **complete** source migration chain, not just its tip |
| DB payload | Hash + size of the portable DB payload |
| Resource requirements | Existence-oriented requirement inventory |
| Resource payloads | Included payload inventory + cryptographic hashes; file units authenticate one portable `executable` bit |
| Directory-unit hash spec | See §5.1.2 |
| Exclusions/degradations | `resource:<kind>` for an omitted whole unit; `resource-entry:<kind>` for an omitted entry inside an otherwise valid payload |

All cryptographic hashes are **SHA-256, 64 lowercase hex** (the `hashDbFile`
representation). Archives contain **plaintext credentials**. Output mode `0600`
protects local permissions only; export and restore UI MUST warn that copied
archives expose API keys.

### 5.1.2 Canonical directory-unit hash

A directory payload (a Knowledge base, a Skill, a Notes tree) is content-addressed
by one SHA-256 (`hashDirectoryUnit`). The producer (over the already materialized
staged tree) and admission (over the extracted tree) compute the identical digest
through the scanner's strict mode, so they can never disagree on membership or order:

- the unit's **directories and regular files** — symlink/special nodes and a
  symlinked root are rejected; **every** relative path passes the Phase-1a
  portable-path rules and shares ONE case/NFC-collision namespace, so nested
  empty directories are both transported and authenticated; the shared
  per-entry / total-byte / path depth+length ceilings and an **entry count that
  includes directory entries** apply during the scan;
- directories and files each sorted by their POSIX relative path (UTF-8 byte order);
- each directory framed as `"D" ‖ u64be(len(relPath)) ‖ relPath`, followed by
  each file framed as
  `"F" ‖ ("X" | "-") ‖ u64be(len(relPath)) ‖ relPath ‖ u64be(byteLen(content)) ‖ content`;
  the second tag authenticates owner-executable vs non-executable, while type tags and length
  prefixes make every boundary unambiguous. No other permission bits cross devices: staged and
  restored files map safely to `0700` or `0600`.

Node metadata identity uses **bigint** stat (`dev`/`ino`/`size`/`mtimeNs`/`ctimeNs`)
so a same-size fast rewrite or a metadata-only change is observable to a re-scan.

Live-source capture uses the scanner's separate capture mode to produce that strict
ordinary-node tree:

- a regular file/directory is included;
- a link whose final target remains inside the same resource unit is expanded and
  staged as an ordinary file/directory, while its link identity and text remain in
  the in-memory drift proof;
- an external or dangling link is not followed or hashed; only the link itself is
  tracked, omitted, and disclosed;
- only the link edge that would close a directory cycle is omitted;
- an unreadable/special/unclassified leaf is omitted and disclosed, without losing
  capturable siblings; if all children are omitted, the directory payload remains
  a legal empty tree;
- an uncapturable resource root omits only that unit.

The four generic decisions are `include`, `materialize-internal`, `exclude-derived`,
and `omit-with-degradation`. Owner policy is opt-in and contains the only semantic
exclusions: Knowledge excludes the exact unit-root
`.cherry/index.sqlite{,-wal,-shm}` artifacts; Agent runtime config excludes the
generated `skills/` mirror; and an Agent workspace excludes only a direct
`.claude/skills/<name>` link whose target is inside the canonical managed Skill
library. A real same-name directory remains authoritative. The scanner contains no
Knowledge, Agent, or Skill filename knowledge.

### 5.2 Admission — rejected before journal creation

Admission is the trust boundary; all of the following fail **before** any journal or live
write:

- Path escapes, dot segments, malformed UTF-16 (lone surrogates), duplicate names, undeclared payloads.
- Archive entries marked as symlinks/special files *before* extraction, plus staged-tree
  `lstat`/`realpath` escapes *after* extraction.
- Entry count, uncompressed size, compression ratio, or per-entry limit violations.
- Hash/size mismatch.
- Incompatible format, or a migration chain **ahead of** / **forked from** the app's chain.
- Any post-migration table/index/view/trigger definition that differs from a
  trusted database built by this app's production migrations. The archive's
  migration journal is data, not proof of its actual schema.
- Corrupt SQLite or an invalid staged migration result.
- A manifest requirement set that differs from the materialized DB's authoritative closure,
  a payload absent from that closure, a payload kind aimed at another kind's root, or a
  missing Full payload without its exact disclosed `resource:<kind>` degradation.
  A `resource-entry:<kind>` degradation never authorizes the whole payload to be absent.

The ZIP catalog preserves every central-directory record instead of using a name-keyed
map, so duplicate entries cannot hide one another. Central-directory sizes and compression
ratios are advisory gates only: extraction streams each regular entry into an exclusively
created file and proves actual bytes equal the declared size while enforcing shared
per-entry and cumulative actual-byte budgets. Extraction occurs only under an
identity-tracked, operation-owned staging root after disk preflight; cancellation and
failure clean that root without touching siblings.

Migration compatibility is directional and item-wise; the final schema alone is not a
compatibility proof because a migration may transform data or establish semantic invariants:

| Archive chain vs bundled chain | Admission | User-facing action |
|---|---|---|
| Exact | Accept | Continue restore |
| Strict prefix (archive older) | Apply trusted bundled suffix, then re-prove | Continue restore; preview records migrate-forward |
| Archive extends bundled chain | Reject as `source-ahead` | Upgrade to a build containing that suffix, then retry |
| Mismatch inside shared prefix | Reject as `lineage-fork` | Use the producing lineage or one of its descendants |

Ahead/fork and unsupported-format failures cross IPC as closed, bounded diagnostics rather
than raw admission prose. They contain only producer/current versions and build types,
chain counts, one-based divergence/extra indices, and fixed migration-tip hash prefixes.
Archive paths, managed-root paths, raw Zod/library errors, and arbitrary manifest detail do
not cross that boundary. New archives record whether the producer was packaged or a
development build; the field is optional so existing format-v2 archives remain readable and
report `unknown`. The complete chain remains authoritative—there is no duplicated
`minRestoreVersion` or migration-tip claim.

The renderer presents these expected compatibility failures in an acknowledgement dialog,
including a path-free diagnostic block the user can copy. A packaged current build offers the
existing manual updater only for a newer packaged/unknown source chain or format; a
development archive, a development target, or a fork instead directs the user to the producing
lineage or one of its descendants. Updating never bypasses admission—the user selects the
archive again and the new build re-proves the complete chain.

Malformed, corrupt, tampered, manifest↔DB chain-mismatched, or failed-migration archives
remain generic archive rejections: presenting any of those as “upgrade required” would turn
an integrity failure into misleading compatibility advice. Every compatibility refusal still
runs admission's owned-staging cleanup and occurs before restore-journal creation.

A valid **older-chain** staged DB migrates forward with the production migrations and
passes integrity checks (it is not rejected). The staged DB's actual complete chain must
first equal the manifest chain, which must be an exact prefix of the bundled chain. After
migration/custom-SQL refresh, admission compares the complete `sqlite_schema`
against a trusted in-memory production database before portable sanitation can
execute any data write. It then checkpoint-seals the DB into one main file,
requires both WAL/SHM sidecars to be absent, and returns final hash/size/chain
separately from the unchanged original manifest. A **downgraded binary** reading a v2 journal
fails safely through strict-version refusal without touching live data (the journal schema is
a `strictObject` with a literal version). A corrupt, unreadable, or future-version journal is
never quarantined or cleared automatically: it may be the only durable evidence naming a
partially moved database/resource set. Preboot preserves the journal, staging tree, and
asides, then refuses normal startup until a compatible build or explicit repair can prove a
coherent state. This applies even when the live DB currently exists—presence alone does not
prove that every resource matches it. A journal in the abandoned v1 format — written only by
the v2.0.0 pre-releases, never by stable v1 — is different: preboot never executes it and
never parses it. It is renamed aside (`.parked-v1`, never overwriting an earlier parked one)
and the boot continues, so an upgrade drops the requested restore instead of carrying out a
database replacement the user has long since forgotten. If the live DB is missing, the
journal is left under its original name and startup is refused instead — reinstalling the
pre-release is then the way to finish that restore. Nothing is deleted either way: the
journal and everything v1 staged or parked aside stay on disk.

### 5.3 Frozen operating ceilings

Bounded ceilings are frozen in the format contract and shared by preflight and admission
(same constants): maximum archive entries, resource-install entries, path depth/length,
per-entry and total uncompressed bytes, compression ratio, and staging disk headroom.

- Large-file/directory staging checks cancellation incrementally.
- **The archive entry count is aggregated before the first payload copy.** The staging
  baseline sums every admitted unit's entries plus the fixed archive entries
  (`manifest.json`, `backup.sqlite`, and the optional `attestation.json`, reserved
  unconditionally so one archive's payload budget never differs from another's) and
  refuses over the ceiling there; publication
  re-checks the same bound over the finished tree. Units the baseline excluded contribute
  nothing — they never become payloads. Without the preflight the only check would come
  after the whole tree had been copied.
- **The manifest byte cap must cover the resource-install ceiling.** `manifest.json` carries
  the requirement inventory and (for Full) the payload inventory, so its size scales with the
  profile, and the pre-parse cap is the only bound on those arrays. The two ceilings are
  therefore not independent: at the frozen 50,000 resource-install entries a manifest measures
  ~14 MiB of payloads plus ~5 MiB of requirements. A cap below that makes an archive at the
  install ceiling **unproducible and unadmissible** — the ceilings would contradict each
  other. `maxManifestBytes` is 32 MiB for exactly this reason, and a test builds a manifest at
  the install ceiling to prove the two constants still agree.
- Before `prepared` is written, restore `fsync`s every staged DB/resource file, then all
  staging directories bottom-up and the staging parent's entry on POSIX. This provides the
  stated sudden-power-loss ordering on POSIX. Windows cannot fsync directory handles, and
  Node/libuv rename does not request `MOVEFILE_WRITE_THROUGH`; Windows guarantees
  process-crash recovery, not sudden-power-loss metadata durability.
- Resource-install `fsync`s affected parent directories in **bounded batches** before the
  global step marker — including the parents whose entries create a new
  `restore-aside/<restoreId>` tree — not once per entry. A ceiling fixture proves this bound;
  a recorded, non-gating benchmark documents expected preboot time.

### 5.4 Application-level export transaction

Export uses an application-level snapshot transaction, not a SQLite transaction:

```text
PREPARING → QUIESCING → SEALED → COPYING → VERIFIED → COMMITTED
                 └──── any pre-commit failure ────→ ABORTED
```

`ProfileWriteBarrierService` is the shared admission boundary for direct profile writers.
`runWrite()` covers promise-scoped mutations; `acquireWriteLease()` covers streams and
callbacks until `finish`/`abort`. Nested calls inherit their lease through
`AsyncLocalStorage`, so an admitted DataApi owner that writes a file does not double-count
or deadlock. Paused writers wait outside the in-flight count, and shutdown rejects queued
writers without force-killing admitted work.

`FileManager` is the v2 owner for file, stream, trash, delete, and sweep mutations.
The deprecated `FileStorage` singleton is not a lifecycle participant and the export
transaction never resolves or depends on it; its remaining legacy mutation entry points
use the shared barrier only as a temporary compatibility guard until those IPC routes are
removed.

One 30-second monotonic deadline governs sealing:

1. Channel intake enters defer mode and flushes, then drains already admitted work into
   Agent/AI.
2. Channel adapter runtime, AI, Agent, Job, and Claude warm-query pause and drain.
3. The profile write barrier closes and drains DataApi, Preference, File, Knowledge,
   Skill, credential/context-token, and other owner-scoped direct writes.
4. MCP runtime pauses last and drains tool calls, client initialization, and managed
   memory/workspace writes.
5. With every verdict clean, synchronous `VACUUM INTO` creates the detached DB. It cannot
   be interrupted; deadline and cancellation are checked immediately after it returns.
6. Requirements are derived from the detached DB. Every required file records
   `dev`/`ino`/`size`/`mtimeNs`/`ctimeNs`; directory trees and owner projections are
   scanned and immediately rescanned while writes remain paused.

The `finally` path releases every hold in strict reverse order — MCP, profile barrier,
Job/Agent/AI/warm-query/Channel runtime, then Channel intake — without letting a release
error hide the original export failure. Deferred requests then resume normally; they are
not rejected as busy and messages are not discarded.

Bulk work happens after writers resume. The detached DB is materialized, requirement
closure is checked again, and resources are copied against the sealed baseline:

- **Files:** sealed identity plus source-handle pre/post metadata are compared while
  streaming to the staged hash.
- **Directories:** the sealed deterministic tree manifest, per-file pre/post checks, and a
  final tree rescan must all agree. Materialized internal-link targets are copied through
  their physical source paths into virtual ordinary archive paths; omitted links are
  rechecked by `lstat` + `readlink` without reading their external targets.
- Cancellation is checked per chunk/file. Unit staging is removed on failure, but the
  export itself always aborts.

- **Rebuildability (units whose derived state is excluded):** because export drops a
  Knowledge base's `.cherry/index.sqlite`, the `raw/` material is the only thing the
  restoring device could rebuild that index from. The baseline therefore proves, from the
  sealed database alone, that every completed indexable leaf has its material inside both
  matching scans taken while writers are paused. A base
  that cannot supply it (notably a v1→v2 upgraded directory child that only ever had a
  virtual path) is degraded out WHOLE with `unrebuildable-content` rather than shipped as
  an index-less shell. The cost is disclosed, not silent: such a base is not protected by
  the backup, and carrying the index instead is a separate, negotiated change.

An uncapturable root records `resource:<kind>`; an omitted entry records
`resource-entry:<kind>` with one of `external-reference`, `dangling-reference`,
`cyclic-reference`, or `unclassified-reference`. Degradations persist only safe
profile-relative sample paths, never an external absolute target. Any later addition,
deletion, replacement, link retarget, content or tree change fails with
`BACKUP_EXPORT_SOURCE`; an unportable path or ceiling violation also fails the whole
export. No `changed-after-snapshot` degradation is produced, so the detached database is
never published with an unproven filesystem view.

---

## 6. Journal v2 & Promotion

Runtime never writes restored rows into the live DB. It stages and seals the archive DB,
then writes a journal-v2 state machine. Journal primitives, durability invariants, and the
promotion gate live in
[`src/main/data/db/restore/`](../../../src/main/data/db/restore/README.md) and
[`src/main/core/preboot/backupRestoreGate.ts`](../../../src/main/core/preboot/backupRestoreGate.ts).
The gate stays in `core/preboot` because it owns startup ordering, not Backup business
semantics. It invokes the generic data-layer state machine before migrations and before any
database connection; it does not resolve feature or lifecycle services.

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

Restore preparation, arm, and rollback deliberately do **not** reuse export quiescence.
Preparation mutates only admission-owned staging. Arm/rollback recheck the journal and
filesystem topology, durably record the direction, and call the existing
`application.relaunch()` path; they do not pause MCP/AI/Agent/Channel, acquire the profile
write barrier, or orchestrate Application shutdown. Preboot checks every staged/live/aside
triple again before the first rename. A race between arm and process exit therefore refuses
startup when it changes an install fact needed by recovery, rather than expanding restore
into a cross-service lifecycle protocol.

Every state also carries the **degradation report** — what producing and
materializing this archive reduced (§4). Before the journal write, raw rows and
per-resource exclusions are compacted into one true total plus at most three safe
relative path samples per presentation code. It lives in the journal rather than
in memory because the report is shown after the relaunch, once the staging tree
that produced it is gone; without it a degraded restore would present as a complete
one. The bounded report stays far below the journal cap even when thousands of
resources share one exclusion cause.

New journals also carry an opaque `ownerSummary`. Backup obtains each entry from the owner
after archive admission and requirement reconciliation, before moving admission staging or
writing `prepared`. `data/db/restore` validates only that the bag is JSON and carries it
through promotion; it does not interpret Knowledge paths or business IDs. After boot,
Backup routes an owner's entry back to that owner for readiness/rebuild work. The only path
inference is a compatibility helper in `backupRestoreGate.ts` for an already-armed
pre-release v2 journal that predates this field; new writers never call it, and a new-format
journal missing the summary fails closed.

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
| pre-commit | absent | present | absent | Install completed for this unit but pre-commit overall → **rollback** the unit recursively: move installed backup out of live, restore aside when present. Only when the entry's `hadLive` says the target was absent — see below. |
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

- **A missing aside is not proof that nothing was replaced.** Each journal entry records
  `hadLive`: whether preparation found a node in the target slot. Pre-commit `-L-` reads as
  "remove the installed backup" only when `hadLive` is `false`; with `hadLive` `true` the
  aside that held the user's original is gone, `live` is the last copy of anything the unit
  has, and recovery **fails closed** instead of moving it out. Entries written before this
  field existed keep the original reading, and the two paths that must not act on a guess
  refuse them outright: an explicit rollback cannot be armed, and an already-armed reverse
  direction (`rollback-armed`, `reverting`) refuses to boot.
- **An explicit rollback proves the whole topology before it is armed.** Every completed
  entry must still show `live` present, nothing staged, and an aside whose presence matches
  `hadLive` exactly. Arming is the last point a rollback can be refused for free; past it
  preboot must carry the reverse pass out, and a missing aside would surface with earlier
  units already moved. A refusal leaves the completed restore fully intact.

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
keeps the tree and **refuses the boot**: an outcome that never reached the disk is not an
outcome, so the gate stops rather than start the app under a journal that still describes a
restore in flight. Nothing else is touched, and the next boot re-decides from the same
evidence and retries the same terminal write. The reverse order costs
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
state; from `rolled-back` it removes the displaced restored state. A completed Full restore
cannot be acknowledged while any summary-listed Knowledge base lacks owner-proven rebuild
completion, because clearing the journal would also erase its durable retry marker. A deleted
base counts as complete because it has no derived state left to rebuild. The user may also
explicitly stop pending rebuild jobs and keep the restored profile with incomplete search
indexes; that choice is written to the journal before jobs are cancelled, survives a crash,
and permits acknowledgement without making provider availability a storage/GC hostage.
Cleanup idempotently removes operation-owned artifacts **first**, clears the journal **last**,
then releases GC protection. A crash before the last step leaves protection active and cleanup
resumable. Ownership is proven before the first unlink — each park slot must be the one this
device's registry and this restore's id would produce, not merely the one the journal names —
and every artifact is re-proven as it is reached: no symlinked ancestor below userData, and the
artifact itself a plain file or directory. A refusal leaves the journal, and therefore the
retry, in place.

**No newly executed path terminalizes an incomplete direction.** A blocked pre-commit
rollback remains `promoting`; a blocked post-commit reverse remains `reverting`; a blocked
committed install remains `promoting`. The gate fails the launch and retries before normal
services can open either database. The schema still accepts the older defensive
`failed.recoveryIncomplete` and `completed.resourcesIncomplete` markers so an interrupted
development build can be repaired rather than rejected as corrupt; those markers retain their asides,
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

Post-promotion filesystem-derived work is **not** a staged-DB adapter hook. After a
promotion, lifecycle `onAllReady` asks the Knowledge owner to rebuild only base IDs recorded
in the durable restore summary—i.e. material this archive actually transported. The
restore-only path indexes managed material files directly; it never follows an item's
original `data.source`, scans an external folder, or fetches a URL. An archive that
transported no Knowledge material schedules nothing.

Completion is owner-proven (every completed leaf has an index material row), then persisted
per base in the restore journal; existence of `index.sqlite` alone is not completion. A
bounded reconciliation pass schedules/reuses jobs and returns immediately, while a tracked
poll retries until completion without making shutdown wait for embedding work. While any
restore-scoped job for a base remains active, later polls skip that base's full file/material
scan and enqueue pass; they reconcile again only after those jobs settle. A durable user
abandonment marker stops polling across restarts and cancels active restore-scoped jobs before
rollback material is released. Owner capture policies exclude the Knowledge
`{baseId}/.cherry/index.sqlite{,-wal,-shm}` artifacts and the generated
agent-runtime `skills/` mirror; the generic scanner contains neither rule. Export ships a
Knowledge base only after proving it carries the material that rebuild needs (§5.4).

---

## 7. Resource Ownership (Adapters)

A **private, static** resource-adapter list lives inside the backup service module for
known out-of-database content:

```ts
interface BackupResourceAdapter {
  readonly kind: BackupResourceKind
  readonly capturePolicy?: (roots: ResourceRoots) => CapturePolicy
  collectRequirements(ctx: SnapshotReadContext): readonly ResourceRequirement[]
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

The ownership direction is fixed:

```text
Backup orchestration → owner pure projection/readiness policy
Backup orchestration → generic data snapshot/restore → @main/utils/file
owner policy ─X→ Backup types, manifests, journals, or state machines
```

Backup may enumerate a detached database and assemble inventory, but it must ask the owner
to classify owner-specific meaning. Current examples are:

| Owner | Pure policy supplied to Backup |
|---|---|
| FileManager/File | Canonical internal blob filename; runtime mutations remain FileManager-owned |
| Knowledge | Derived-index exclusion, required rebuild material, restore readiness summary |
| Skill | Canonical library and generated `.claude/skills` projection classification |
| Agent | Automation deactivation, permission fallback, unavailable workspace projection |
| Channel | Inactive capability projection and safe malformed-config fallback |
| MCP | Inactive/trust reset, `dxtPath` removal, safe malformed-field fallback |

These policies expose ordinary owner inputs/outputs and import no Backup types. Backup owns
the database queries, degradation aggregation, resource-kind mapping, manifest/journal
state, staging, and transaction errors. A missing owner policy is caught by schema and
dependency audit tests; it is not deferred to a user's export.

Policy consistency is defined **per role**, not by forcing every owner into one universal
service interface:

- Portable-DB sanitizers accept untrusted values and return the shared
  `PortableProfileSanitization<Patch, MalformedField>` shape. Each owner supplies the
  exact patch type, a literal union of reportable fields, its runtime schemas, and the
  fail-closed fallback. Backup applies the returned patch as a whole rather than
  reconstructing owner columns.
- Durable restore readiness is an owner-produced JSON entry. The data layer transports
  the bag opaquely; the owner validates its entry with its own runtime schema and returns
  the shared `ok` / `missing` / `invalid` read result.
- Capture predicates and resource projections keep their narrower owner-specific return
  types. Owners that have no derived capture node or post-restore readiness work do not
  implement empty placeholder methods merely for symmetry.

The shared structural types live in `src/main/data/portableProfilePolicy.ts`; they contain
no Agent, Channel, MCP, Knowledge, manifest, journal-state, or resource-kind semantics.
`unknown` at an archive input is intentional—type safety begins only after the owning
schema validates it. Owner outputs must not fall back to `Record<string, unknown>` or an
unbounded `string[]` diagnostic.

**Resource unit by ownership:**

| Content | Unit |
|---|---|
| Immutable/internal file blob | Individual file |
| Knowledge Base | `{baseId}` directory as one unit; exclude/rebuild derived index |
| Local/ZIP Skill | Skill directory as one unit |
| Built-in MCP workspace | Managed workspace root as one unit |
| Built-in MCP memory | Profile-owned `Data/Mcp/memory.json` file |
| Agent channel state | Managed channel-state root as one unit; activation remains reset |
| Agent runtime config | Managed `.claude` root as one unit; exclude generated `skills/` mirror |
| Notes | Managed markdown file/tree entries; external Notes roots never automatic targets |
| Agent/MCP managed directories | Only after their owner declares a registered safe root and archive contract |

A directory resource installs as a unit; recursively overlaying two Knowledge/Skill
directories would create an unvalidated mixed resource and is forbidden.

**No adapter field** carries any merge fact: no table ownership, primary-key identity
class, aggregates/members, conflict defaults, unique merge rules, DB FK/reference actions,
or clone/remap/transform hooks. Merge facts do not exist in v2.

---

## 8. User-Visible Scope

**Export UI:** one action, no choice to make. It warns about plaintext credentials, and
that restored executable/network integrations are disabled until re-confirmed on the
target device.

**Restore preview:**

- Resource coverage on this device — available / rebuildable / missing counts (a
  partition of the requirements) plus the separate external-unverifiable count, with
  **no** content-equality claim.
- A current estimate of resources to install or replace, plus unsupported external
  resources; the preboot state machine owns the final result.
- Any degradation is shown by grouped cause and bounded safe relative path samples during
  export, in restore preview, and again after a completed restore.
- Destructive fact: the current database is replaced and the app restarts.

No merge, skipped-record, field-conflict, or domain-conflict language appears anywhere in
the UI.

---

## 9. Phase Ownership & Security Boundaries

| Phase | Owns |
|---|---|
| 0 (this doc) | The frozen contract and defaults ([§1](#1-approved-defaults-frozen)); no product code. |
| 1 | Manifest v2, portable DB sanitizer/materializer + managed-root rebasing, journal-v2 states + `resource-install` transition table, secure archive assembly/admission, ceilings, source-drift protocol. Proved by focused tests before UI. |
| 2 | DB-only export/prepare/arm/preboot replacement; lifecycle-owned `BackupService`; live WAL checkpoint; GC protection + acknowledgement; existence inventory. |
| 3 | Full resource capture + unified file/directory installation with crash matrices; durable restore summary feeding the reindex scheduler. |
| 4 | Narrow IpcApi routes/events over the Phase-2 service; export & restore UI; merge copy/types removed; i18n + breaking-change docs. |
| 5 | End-to-end proof, adversarial review, repository gates, replacement PR targeting `main`. |

**Security boundaries:**

- **Archive admission** ([§5.2](#52-admission--rejected-before-journal-creation)) is the
  single trust boundary — nothing untrusted reaches a journal or live write before it
  passes.
- **IpcApi handlers** stay thin: sender policy (the caller must be a WindowManager-owned
  window, including the Main window that hosts Data Settings), schema validation,
  `IpcError` mapping, and delegation to `BackupService`. Backup has no dedicated window.
  See [IPC Reference](../ipc/README.md).
- **Error boundary is path-free.** What crosses to the renderer is a fixed code, a fixed
  sentence chosen at the boundary, and whitelisted numbers/closed enums — never an
  underlying message, an absolute path, an archive-controlled name, or a journal read
  report. An unpredicted fault becomes a detail-free `INTERNAL`. Originals stay in the
  main log, which is where a diagnosis happens.
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
| Restore journal fsync primitives, promotion step/commit probing, crash recovery, `markRestoreFailedAfterCrash`, `isLiveDbStranded`, `runRestorePromotion` | `src/main/data/db/restore/{restoreJournalV2,restorePromotionV2}.ts` |
| Preboot restore gate | `src/main/core/preboot/backupRestoreGate.ts` |
| Path registry / containment rules (`feature.backup.*` keys) | `src/main/core/paths/pathRegistry.ts` |
| Orphan sweep | `src/main/services/file/internal/orphanSweep.ts` |
| Its `hasPendingRestore()` stand-aside guard | `src/main/data/db/restore/restoreGuard.ts` |
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
the shared profile write barrier and fixed **export-only** quiesce/drain sequence; sealed DB/resource
baselines with fail-closed source drift; ZIP read-back verification and operation-owned
crash cleanup; existence inventory, path-overlap/same-filesystem enforcement,
completed-restore GC protection, and acknowledgement cleanup.

**Explicitly excluded — do NOT port and do NOT reintroduce:**

- `MergeEngine` and the merge helper directory.
- 10/14-domain Lite stripping and `SqliteBackupStripper` domain-deletion logic.
- `resourcePlanning` local-record skip semantics.
- Identity propagation, dangling-reference repair, and DB-merge conflict/degradation
  contracts.
- Restore-time live snapshot, renderer write-quiesce, and DB fingerprint expiry — replaced
  by the mandatory live preboot WAL checkpoint ([§6.2](#62-live-wal-checkpoint-is-mandatory)).
- Restore arm/rollback orchestration of runtime pause/drain or lifecycle shutdown. Runtime
  only seals the durable direction and requests relaunch; data replacement remains preboot.
- Any incremental backup, cross-database merge, domain stripping, or public contributor
  framework.

The replacement PR targets `main` and its description explicitly supersedes #17206's
selective-domain merge contract.
