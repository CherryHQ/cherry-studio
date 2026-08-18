# Backup & Restore Architecture (v2)

This document is the decision authority for Backup v2. Backup is a portable
replacement of the main database plus the owner-managed resources needed to use
that database. It is not a row merge and it is not a stop-the-world copy of the
whole profile.

The consistency contract is:

```text
consistent main SQLite snapshot
+ owner-scoped resource snapshots
+ owner proof of readiness or explicit degradation
```

Each `+` is a composition boundary, not a claim that every byte came from one
global instant. The main database defines the authoritative business-data cut.
Each resource owner then produces a self-consistent cut that satisfies that
detached database, or explains exactly what could not be transported.

## 1. Product contract

Backup has one preset, `full`.

```text
Full restore =
  replace the main database
  + install archive-authorized resource units
  + keep target-only paths outside those units
```

The following rules are fixed:

1. Every archive carries a complete portable main SQLite database.
2. Restore never merges rows from the archive and target databases.
3. The detached database determines the exact resource requirement set.
4. A resource payload can only install at the owner root authorized for its
   `(kind, resourceType, livePath)`.
5. Missing or partially captured ordinary resources are disclosed; they do not
   make an otherwise valid database backup unusable.
6. External user directories are never copied or overwritten.
7. Active/trusted runtime capabilities are deactivated or reset before the
   database enters the archive.
8. Restore promotion happens before the normal database connection opens.
9. Promotion is rename-only and journaled. There is no cross-filesystem copy
   fallback.
10. A committed export or restore is never reported as failed because later
    cleanup could not finish.

“Full” therefore means the complete portable closure Cherry can own and prove,
not every file the application can read.

## 2. Layered consistency model

### 2.1 Export state machine

```text
PREPARING
→ SNAPSHOTTING_DB
→ MATERIALIZING_DB
→ CAPTURING_RESOURCES
→ RECONCILING_OWNERS
→ VERIFYING
→ COMMITTED
```

- `SNAPSHOTTING_DB` uses SQLite snapshot semantics, never a raw copy of an open
  WAL database.
- `MATERIALIZING_DB` rebases managed paths and makes automatic/device-bound
  references inert on the detached copy.
- `CAPTURING_RESOURCES` asks each fixed owner adapter for its own cut.
- `RECONCILING_OWNERS` proves owner-specific invariants such as Knowledge index
  readiness and Agent resume continuity.
- `VERIFYING` hashes staged bytes, writes the ZIP, reopens it, and repeats
  admission checks.
- `COMMITTED` is the no-clobber hard-link publication of the verified temporary
  ZIP into the requested destination.

Any failure before `COMMITTED` removes operation-owned staging and leaves the
destination absent. Cleanup after `COMMITTED` is warning-only debt.

### 2.2 Why there is no global quiescence

Backup does not pause Channel, AI, Agent, Job, MCP, or Knowledge embedding as a
precondition for success. Those systems combine long-running computation,
network I/O, and unrelated resources. Waiting for all of them would turn one
40-minute embedding job into a 40-minute backup and still would not identify
which bytes actually require a shared boundary.

Consistency is instead enforced at persistence ownership boundaries:

- SQLite produces the main-database cut.
- Strict filesystem units prove their own stability while copied.
- Partial trees include only entries that prove a complete byte version.
- Complex open formats are snapshotted by their owner.
- A business relationship spanning several stores is reconciled against the
  detached main database before readiness is asserted.

Background computation may continue. A short owner mutex may delay only the
final persistence section for the resource being captured.

### 2.3 Capture modes

```ts
type ResourceCaptureMode =
  | { kind: 'strict-unit'; maxAttempts: 2 }
  | { kind: 'partial-tree'; maxAttempts: 2 }
  | { kind: 'owner-snapshot' }
```

#### `strict-unit`

The file or directory is useful only as one unit. Capture scans/copies it with
inode, size, nanosecond timestamp, ancestor, link, and tree verification. A
source-drift failure is retried once. If both attempts fail, that unit is omitted
with `changed-during-capture`; unrelated units still ship.

Used by:

- internal File blobs;
- Knowledge raw/source unit;
- canonical Skills;
- Agent identity/memory data;
- Channel credential/context state;
- MCP memory;
- Agent runtime configuration.

#### `partial-tree`

Two owner-scoped scans form the candidate set. A file is included only when its
identity, ancestor chain, and any internal-link chain agree. It is verified
again while copied. A changing sibling, newly created file, or changing subtree
does not invalidate already stable entries.

An empty directory payload remains legal. Omitted entries are reported
individually as `resource-entry:<kind>`.

Used by:

- managed Agent workspaces;
- built-in MCP workspace;
- managed Notes.

#### `owner-snapshot`

The live representation cannot be copied safely as an ordinary file. The owner
must produce the portable staged bytes and validate their business identity.

Used by:

- Knowledge `index.sqlite` as an augmentation of a Knowledge base unit;
- completed-Turn Agent transcript snapshots.

An owner may define a safe fallback. Knowledge can omit an unprovable index and
retain all raw material with `knowledge-index-rebuild-required`. An Agent resume
transcript has no equivalent fallback once its database token is retained, so a
failed transcript snapshot fails the export rather than publishing a dangling
resume point.

### 2.4 A cut remains valid after capture

Once a unit or file has been copied and verified, later changes belong to the
next backup time point. They do not retroactively invalidate the completed cut.
This is the same principle used by an online database backup: consistency
describes the bytes accepted into the snapshot, not a promise that the live
source will stop changing afterwards.

## 3. Resource and reference policy

### 3.1 Managed resources

| Resource kind | Managed source | Mode | Restore meaning |
|---|---|---|---|
| `file-blob` | `Data/Files/<id>.<ext>` | strict | exact blob referenced by DB |
| `knowledge-base` | `Data/KnowledgeBase/<baseId>` | strict + owner snapshot | raw material plus ready index or rebuild marker |
| `note-root` | `Data/Notes` | partial | managed note tree |
| `agent-data` | `Data/Agents/<agentId>` | strict | identity and memory |
| `agent-transcript` | `Data/AgentTranscripts/<sessionId>.jsonl` | owner snapshot | last successful native resume prefix |
| `agent-workspace` | managed system workspace | partial | stable workspace entries |
| `skill` | `Data/Skills/<name>` | strict | canonical Skill library |
| `mcp-workspace` | `Data/Workspace` | partial | built-in workspace only |
| `mcp-memory` | `Data/Mcp/memory.json` | strict | built-in memory graph |
| `agent-channel-state` | `Data/Channels` | strict | credentials/context, restored inactive |
| `agent-runtime-config` | `Data/Agents/.claude` | strict | portable runtime config without derived mirrors/caches |

Each kind maps to exactly one registered path root. Backup resolves roots through
`application.getPath()` and records only userData-relative install paths.

#### Per-kind policy

Each entry states the four decisions that define a kind: how requirements are
derived from the detached database, how bytes are captured, what the portable
database policy does to the rows that reference it, and what restore does after
promotion. Degradation semantics follow §2.3 unless stated.

**`file-blob`** — one requirement per `file_entry` row with `origin='internal'`,
soft-deleted (trash) rows included: the database snapshot preserves those rows,
so their bytes must stay restorable. Capture: strict unit per blob; a drifting
blob degrades alone. Portable DB: `origin='external'` rows are deleted
(`external-file-dropped`) — their absolute paths would auto-resolve on the
target. Restore: per-file install; nothing derived.

**`knowledge-base`** — one requirement per `knowledge_base` row; required
content is the `raw/` and processed material of every COMPLETED indexable
`knowledge_item`, and a base that cannot supply it degrades out as a whole
(`unrebuildable-content`) rather than shipping an index-only shell. Capture:
strict unit excluding the live `index.sqlite` WAL family, then the owner
snapshot inside the per-base mutation mutex (§5.2): online SQLite backup →
prune material committed after the DB snapshot → prove
identity/schema/material/embeddings/FTS (§5.3). Proof passes →
`.cherry/index.sqlite` ships and the base restores `ready`; any proof fails →
the index is dropped from staging and the base ships `rebuild`
(`knowledge-index-rebuild-required`). Portable DB: auto-executing
`knowledge_item.status` values reset. Restore: `ready` bases search
immediately; `rebuild` bases re-embed post-promotion from transported material
only (never a source URL), with per-base completion persisted in the journal
and an explicit user abandon path at acknowledgement.

**`note-root`** — always exactly one requirement: the managed Notes root. The
`note` table is sparse star/expand state, not a file index, so rows never map
to units. Capture: partial tree. Portable DB: `note.root_path` rebases under
the managed root; a user-chosen external root stays verbatim as inert
metadata. Restore: the tree replaces as one directory unit.

**`agent-data`** — one requirement per live `agent` row
(`Data/Agents/<agentId>`, identity and memory). Capture: strict unit. Portable
DB: `agent.configuration` is made inert — `heartbeat_enabled` /
`scheduler_enabled` forced `false`, `bypassPermissions` stripped, malformed
fields failed closed. Restore: install; automation stays off until the user
re-enables it.

**`agent-transcript`** — one requirement per session whose
`runtime_resume_token` is a versioned portable resume point
(`{sdkSessionId, lastAssistantUuid}`); raw pre-feature tokens are cleared
instead (`runtime-reference-reset`). Capture: owner snapshot — read the SDK's
own `projects/<encoded cwd>/<sdkSessionId>.jsonl` (encoded path first, then a
uuid-filename scan, so export never depends on the encoding) and cut it
through the retained assistant uuid; entries past the anchor and a torn tail
belong to the next backup. A retained token whose transcript cannot be cut
fails the export — there is no safe fallback. Subagent sidecar files are not
transported. Restore: the canonical file installs at `Data/AgentTranscripts/`;
the session's first warmup projects it to the SDK's encoded-cwd location,
soft-failing to a fresh session (§6.1).

**`agent-workspace`** — one requirement per `agent_workspace` row whose `path`
is physically inside the managed workspaces root — containment, not the
`type` column, is the test, because a hostile database controls the column.
Disconnected placeholders stay unverifiable. Capture: partial tree; managed
skill-projection links are excluded as derived state (§6.2). Portable DB: the
three-layer policy of §4 — managed paths rebase; an external path is kept
verbatim when the archive is self-attested, or when the string proves local
and a real directory is present; everything else disconnects (placeholder
path, original parked in `disconnected_path`, sessions preserved). Restore:
managed units install; the workspace cut and the transcript cut stay
independent.

**`skill`** — one requirement per `agent_global_skill` row at
`Data/Skills/<folder_name>`. Capture: strict unit; the `.claude/skills` mirror
is never captured (derived). Restore: install; startup `reconcileSkills()`
rebuilds the mirror and catalog (§6.2).

**`mcp-workspace`** — one fixed requirement: the built-in `Data/Workspace`
directory. Capture: partial tree. Restore: install; nothing derived.

**`mcp-memory`** — one fixed requirement: `Data/Mcp/memory.json`. Capture:
strict unit. Portable DB: `mcp_server` rows deactivate — `is_active`,
`is_trusted`, `dxtPath` cleared; malformed executable/network fields failed
closed. Restore: servers return configured but inactive and untrusted.

**`agent-channel-state`** — one fixed requirement: the `Data/Channels`
directory. Capture: strict unit. Portable DB: `agent_channel.is_active` forced
`false`; the inert `config` is preserved as stored — explicit activation
revalidates it. Restore: credentials and continuity state install inactive.

**`agent-runtime-config`** — one fixed requirement: `Data/Agents/.claude`.
Capture: strict unit excluding `skills/` (Skill owner projection, §6.2) and
`projects/` (the SDK's live transcript cache; the `agent-transcript` owner
snapshot carries resume continuity instead). Restore: installs as one unit;
excluded subtrees are rebuilt by their owners.

### 3.2 Links and special nodes

- Internal symlinks are materialized as ordinary archive files/directories.
- External and dangling links are not followed.
- Only the edge that forms a link cycle is omitted.
- Unclassified references and special leaf nodes are omitted.
- Omitted edges record a safe relative path, never the external absolute target.
- A resource root that is itself an external link is omitted as a whole unit.

The stable degradation reasons are:

- `external-reference`;
- `dangling-reference`;
- `cyclic-reference`;
- `unclassified-reference`;
- `changed-during-capture`.

### 3.3 External and device-bound references

Non-filesystem references are handled by the portable database policy:

```ts
type PortableReferenceAction =
  | 'preserve-inert'
  | 'rebase'
  | 'reset'
  | 'deactivate'
  | 'drop'
```

Unknown active values must take an owner-defined safe fallback. An archive must
not activate an unknown command, network integration, workspace, credential
consumer, or trust decision on the target device.

## 4. Portable main database

`DbService.createSnapshot()` creates the detached main database using SQLite
snapshot semantics (`VACUUM INTO`). The live database and its WAL are never
copied as independent files.

Portable materialization then:

- preserves business rows and the applied migration chain;
- resets pending runtime work that cannot resume safely;
- rebases Cherry-managed paths onto the target’s registered roots;
- keeps same-install attested external workspaces or disconnects them safely;
- deactivates Agent, Channel, and MCP automation;
- clears MCP trust and `dxtPath`;
- resets target-local tokens and device settings;
- clears legacy/raw Agent resume tokens that have no transported transcript.

Materialization runs only on the detached copy. Its output is hashed after
sealing, and those exact bytes are the archive’s `backup.sqlite`.

## 5. Knowledge index portability

### 5.1 Format portability

Knowledge `index.sqlite` is an ordinary SQLite database:

- schema and tables are engine-neutral SQLite;
- vectors are fixed little-endian float32 bytes in a plain BLOB;
- no platform-native `sqlite-vec` library is stored in the database;
- the target loads its own compatible native extension;
- `meta.base_id` and `meta.schema_version` identify ownership and layout.

This makes the file engine-portable across macOS, Windows, and Linux. It does
not make copying an open WAL database safe.

### 5.2 Online owner snapshot

`KnowledgeVectorStoreService.snapshotPortableIndex()` uses
[`better-sqlite3` `Database.backup()`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise)
to produce one complete SQLite file. The result contains committed main/WAL
state and does not transport `-wal` or `-shm` sidecars.

Embedding API calls continue. The Knowledge base mutation mutex serializes only
the owner persistence boundary:

```text
capture raw/source unit
→ online index snapshot
→ reconcile detached index with detached main DB
→ release owner boundary
```

### 5.3 Reconciliation and readiness

The detached index is accepted only after the Knowledge owner:

1. runs `PRAGMA quick_check`;
2. verifies `meta.base_id`;
3. verifies the current schema version;
4. removes material committed after the main-database snapshot;
5. verifies every completed indexable `knowledge_item.id` has the matching
   `material.material_id` and `relative_path`;
6. verifies each required material has at least one search unit and body text;
7. for vector bases, verifies each retained search text resolves to an embedding;
8. rechecks FTS integrity after pruning.

If all checks pass, `.cherry/index.sqlite` is transported and the owner summary
marks the base `ready`. Search is available immediately after restore.

If any proof fails, the index is deleted from staging, raw/source material is
still transported, and the owner summary marks the base `rebuild`. Cold-start
reconciliation can re-embed it. “Derived” is therefore a fallback property, not
a reason to discard every healthy index by default.

## 6. Agent transcript and Skill projection

### 6.1 Native Agent resume point

The Claude SDK owns the live transcript: an append-only JSONL under the
cwd-keyed `.claude/projects/<encoded cwd>/<sdkSessionId>.jsonl`. Cherry adds no
runtime mirror; the only per-Turn runtime artifact is the versioned resume
point (SDK session ID plus last top-level assistant UUID) stored in the main
database after a successful result.

At export, the Agent transcript owner produces the `owner-snapshot`:

1. reads the resume point and workspace from the detached database;
2. locates the SDK JSONL (encoded-cwd path first, then a `projects/` scan by
   the unique session-id filename, so export never depends on the encoding);
3. cuts the file through the retained assistant UUID — entries appended after
   the database snapshot, including a torn tail the subprocess is still
   writing, belong to the next backup and are discarded;
4. stages the cut as `Data/AgentTranscripts/<sessionId>.jsonl`.

Only the main transcript ships; `subagents/` sidecar files are runtime detail
a resumed session can live without. Restore installs the canonical file and,
on the session’s first warmup, projects it to
`projects/<encoded new cwd>/<sdkSessionId>.jsonl` so the SDK finds it under
the rebased workspace. A failed projection degrades resume to a fresh session
and never blocks the connection.

Export keeps the database token only when the matching transcript is an
`owner-snapshot` requirement. Raw pre-feature SDK tokens are reset during
portable DB materialization, so an archive cannot advertise a resume point
whose transcript it did not carry.

Agent workspace capture remains `partial-tree`; the workspace cut and completed
Turn cut are deliberately independent.

### 6.2 `.claude/skills` is a projection

The authority is:

```text
Data/Skills/<name>                 # Skill owner source of truth
        ↓ reconcileSkills()
Data/Agents/.claude/skills/<name>  # Claude SDK discovery mirror
```

Backup transports `Data/Skills/<name>` and excludes the global mirror.
`reconcileSkills()` recreates the mirror and database catalog after restore:

- POSIX installations may use a symlink;
- Windows and built-in Skills may use a verified copy.

A link is recognized as the managed projection only when it is direct, has the
same name, and targets exactly `Data/Skills/<name>`. A real workspace-local
`.claude/skills/<name>` directory is ordinary workspace content. External,
misnamed, or nested links follow the normal external-reference rules.

The cwd-keyed `.claude/projects/**` runtime cache is also excluded from the
`agent-runtime-config` unit; the per-session `owner-snapshot` cut (§6.1) is
what transports resume continuity.

## 7. Archive verification and publication

The archive contains:

```text
manifest.json
backup.sqlite
resources/<authorized livePath>/**
attestation.json?  # optional same-install proof
```

Before publication:

- path syntax, collisions, nesting, entry counts, and byte ceilings are checked;
- staged payload hashes and sizes are written into the manifest;
- ZIP output is fsynced;
- the ZIP is reopened;
- admission rechecks duplicate entries, path safety, limits, and SHA-256 values.

The only commit operation is a no-clobber hard link from the verified temporary
ZIP to the final path in the same destination directory. No copy or overwrite
fallback is allowed.

### 7.1 Destinations

A **destination** is a place an archive is sent: `webdav`, `s3`, `nutstore`
(WebDAV against a decrypted token), or `local` (a folder the user picked).
`src/main/services/backup/destinations/` owns all four.

**The renderer names a destination; it never carries one.** Routes take
`{ destination }` and main reads the host, bucket, secret, and limit from
Preference itself (`destinationConfig.ts`). No credential is an IPC argument,
and no renderer can aim a backup somewhere the user did not configure. A
destination with missing settings raises `DestinationNotConfiguredError` before
any work starts, which is what lets a scheduled backup distinguish "not set up"
from "upload failed".

**Publication is always local.** The commit above needs a filesystem with hard
links; exFAT and most network mounts have none. Every destination therefore
receives a *finished* archive: the export publishes into `feature.backup.temp`
on a local disk, and only then is the file uploaded or moved across. A local
directory is not an exception — it takes the same path, which is why a backup
folder on a NAS or a USB stick works at all.

**Rotation is device-scoped and runs last.** Generated names are
`cherry-studio.<timestamp>.<hostname>.<device>.zip`, and `isOwnArchive` reads
that name back to decide what `max_backups` may delete. The name and the filter
are one unit: changing either alone starts deleting another machine's backups
out of a shared folder. Two rules hold it together:

- **Pruning happens only after a successful upload.** Making room first turns a
  failed upload into a user with no backups at all.
- **Anything unrecognized is kept.** Archives predating the convention, and ones
  the user named by hand, match nothing and are never pruned — leaving a file
  the app cannot account for beats deleting one it cannot account for.

Listing is deliberately *not* device-scoped: restoring another machine's backup
from a shared folder is the point of having one. Only deletion is narrowed.

Uploads and downloads stream on every destination. An archive is the whole
profile, so materializing one in memory to hand to a client is how a large
backup becomes an out-of-memory crash on the machine that could least afford to
lose it.

### 7.2 Scheduled backups

`backup.auto-sync` is a JobManager type with one schedule per destination, named
after it. `autoSync.ts` owns the handler and the reconciler; `BackupService`
registers the handler in `onInit`, because JobManager's startup recovery cancels
non-terminal jobs whose type has no handler and it wakes on its own timer.

**Preference is the source of truth; the schedule row is its projection.** The
reconciler runs on any change to `data.backup.*.{auto_sync,sync_interval}` and
at `onReady`, and it is written to be safe at any time — which is what makes a
restore recoverable, since a restore forces every schedule row to
`enabled: false` (§7.1's table policy) and only a later reconcile turns back on
the ones the user still wants.

Three rules the reconciler exists to keep:

- **Patch only what differs.** `updateJobSchedule` re-arms on field *presence*,
  not on a changed value, so an unchanged trigger in the patch restarts the
  interval — and a reconcile on every unrelated settings edit would push the
  next backup further away forever.
- **A zero interval is "off", not "immediately".** That is how the settings UI
  spells disabled.
- **`after-startup`, not `skip-missed`.** A daily backup would otherwise never
  run for anyone who does not leave the app open across the interval boundary.

The handler is `abandon`: a backup missed because the app was closed is not
worth replaying at the next launch, since the schedule is about to produce a
fresher one. All destinations share one queue, because an export holds the
service exclusively — concurrent destinations would fail each other with
`BackupBusyError` instead of waiting.

## 8. Restore transaction

Restore is split across runtime preparation and preboot promotion.

### 8.1 Prepare

```text
admit archive
→ verify hashes and resource authority
→ migrate/materialize detached DB
→ recompute exact requirement closure
→ prove required resource content
→ generate owner readiness summary
→ move verified bytes to restore staging
→ write durable prepared journal
```

Preparation does not mutate live data. The preview reports:

- target resource existence (`available`, `missing`, `unverifiable`);
- Knowledge indexes ready for immediate use;
- Knowledge bases requiring rebuild;
- resource units that will be installed or replaced;
- all export and target-side degradations.

### 8.2 Arm and preboot promotion

Explicit confirmation changes only the durable journal from `prepared` to
`armed` and requests the existing relaunch path. No runtime service shutdown
protocol is part of Backup.

At the next startup, before the database opens, the preboot gate:

1. validates every staging/live/aside path and ancestor;
2. verifies type, `hadLive`, and same-filesystem rename eligibility for all
   units before the first rename;
3. moves live database/resources to restore-owned aside paths;
4. renames staged database/resources into their live paths;
5. records each step durably and resumes idempotently after a crash.

The journal remains the authority for rollback and cleanup. A completed restore
can be rolled back until the user acknowledges it. Acknowledgement removes the
displaced side and clears the journal last.

## 9. Failure boundaries

### 9.1 Degrade and continue

- missing or wrong-typed ordinary resource unit;
- a strict unit that changes through both capture attempts;
- a changing entry in a partial tree;
- external, dangling, cyclic, special, or unreadable leaf;
- resource ceiling exceeded by one ordinary unit;
- Knowledge snapshot/identity/schema/material/vector proof fails and raw
  material remains rebuildable.

### 9.2 Fail without publishing

- main database snapshot or portable materialization fails;
- owner snapshot has no safe fallback (for example a retained Agent resume token
  without its transcript);
- required content cannot be made safe in the detached database;
- staging, disk, ZIP, hash, or read-back verification fails;
- cancellation;
- no-clobber hard-link commit fails.

### 9.3 Cleanup debt

Cleanup must never:

- overwrite the original failure;
- delete a committed archive;
- turn a successful commit into a reported failure.

Operation markers and owned-path identity checks allow later startup sweeps to
remove only staging that Cherry can prove it created.

## 10. Ownership and dependency boundaries

- Resource owners expose pure capture/projection/readiness policy without
  importing `services/backup`.
- Backup owns archive format, fixed adapter dispatch, resource kinds,
  degradations, verification, and commit/rollback orchestration.
- `data/db/restore` owns only the generic journal and rename state machine; owner
  summary/progress bags are opaque JSON there.
- The preboot gate does not resolve runtime Knowledge, Agent, Channel, or MCP
  services.
- `utils/file` owns business-agnostic durability, rename-only, identity, safe
  ancestor, and owned-path deletion primitives.
- There is no public contributor registry, global writer barrier, or dynamic
  pause/drain framework.

New resource kinds require:

1. a registered managed root;
2. a detached-DB requirement adapter;
3. one capture mode;
4. required-content and reference policy where applicable;
5. owner readiness or safe degradation semantics;
6. restore install/readiness tests;
7. static dependency-boundary coverage.

## 11. Required verification

Changes to this subsystem must cover:

- main SQLite snapshot and materialization;
- strict retry/degradation and partial-tree stable-entry capture;
- internal/external/dangling/cyclic link handling;
- Knowledge online snapshot, wrong base/schema, newer-material pruning,
  material-ID/path mismatch, missing search unit, and missing embedding;
- Knowledge ready versus rebuild restore summary;
- Agent completed-Turn transcript and dangling-token prevention;
- canonical Skill transport and global mirror exclusion;
- ZIP read-back, disk full, cancellation, and atomic no-clobber publication;
- restore admission, prepared/armed journal, preboot promotion, rollback, and
  acknowledgement;
- macOS/Linux symlink and Windows junction/path behavior.

The standard verification sequence is:

```text
targeted Vitest
pnpm format
pnpm lint
pnpm test
pnpm test:lint
```
