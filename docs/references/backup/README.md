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
| `agent-transcript` | `Data/AgentTranscripts/<sessionId>.json` | owner snapshot | last successful native resume prefix |
| `agent-workspace` | managed system workspace | partial | stable workspace entries |
| `skill` | `Data/Skills/<name>` | strict | canonical Skill library |
| `mcp-workspace` | `Data/Workspace` | partial | built-in workspace only |
| `mcp-memory` | `Data/Mcp/memory.json` | strict | built-in memory graph |
| `agent-channel-state` | `Data/Channels` | strict | credentials/context, restored inactive |
| `agent-runtime-config` | `Data/Agents/.claude` | strict | portable runtime config without derived mirrors/caches |

Each kind maps to exactly one registered path root. Backup resolves roots through
`application.getPath()` and records only userData-relative install paths.

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

The Claude SDK’s live transcript cache is keyed by workspace and may contain a
partially written Turn. Backup does not transport that cache.

Cherry’s Agent transcript owner:

1. lets the SDK append entries to an in-memory store;
2. commits a portable transcript only after a successful result;
3. truncates it through the last top-level assistant message UUID;
4. atomically writes `Data/AgentTranscripts/<sessionId>.json`;
5. stores a versioned resume point containing the SDK session ID and assistant
   UUID in the main database.

Export keeps the database token only when the matching transcript is an
`owner-snapshot` requirement. Restore rebases the workspace independently and
the session store exposes the committed prefix under the new workspace key.
Raw pre-feature SDK tokens are reset during portable DB materialization, so an
archive cannot advertise a resume point whose transcript it did not carry.

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

The cwd-keyed `.claude/projects/**` runtime cache is also excluded; portable
Agent transcript ownership replaces it for resume continuity.

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
