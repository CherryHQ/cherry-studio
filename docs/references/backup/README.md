# Backup & Restore Architecture (v2 Lite)

> This document is the contract for Backup v2 Lite. Full resource transport is deferred; Lite must not grow a speculative Full API.

## Product contract

Lite exports one complete, portable SQLite database as a `.cherrybackup` archive. Restore replaces the target database and **does not create, replace, delete, or scan target managed resources**. It is not a merge and it is not a cross-device resource migration.

The archive contains exactly:

```text
manifest.json
backup.sqlite
```

## Legacy v1 convergence

Version-1 restore compatibility is read-only upgrade convergence: preboot may read and execute an already-on-disk version-1 journal to reach a terminal state. No running application route creates a version-1 journal, accepts a legacy archive, or exposes a legacy backup/restore IPC or preload API.

`manifest.json` has literal `preset: "lite"`; no alternate preset, empty resource list, or future extension payload is accepted. Its bounded `degradations` report contains only closed `{ code, count }` portable-DB sanitation aggregates—never row IDs, paths, or field details.

## Safety boundary

Restore treats every archive as hostile input. Before creating a restore journal or mutating the live DB, admission:

- catalogs ZIP records including duplicate local headers;
- rejects unsafe names, duplicate/extra entries, links/special nodes, containment escapes, and declared or actual byte-budget violations;
- proves exact database hash and size;
- accepts only exact or strict-prefix migration chains, using bundled trusted migrations for forward migration;
- proves the final SQLite schema before portability sanitation.

Portable materialization rebases only registered managed roots, removes external file references, keeps restored external workspaces unconfirmed, resets executable/network automation, and regenerates the target-local API Gateway key. Raw SQLite file copying is forbidden: export uses a sealed `DbService.createSnapshot()` image.

## Restore transaction

```text
choose archive → admit/materialize/stage → durable prepared journal
→ user confirms exact restoreId → relaunch
→ preboot checkpoint + park live DB → promote staged DB
→ keep or rollback → acknowledge cleanup
```

`prepared` is not consent. Promotion runs preboot while `DbService` is absent. The old database remains beside the live DB until the user explicitly keeps or rolls back; acknowledgement deletes the verified aside before the journal. Unknown, corrupt, or ambiguous journal evidence is preserved and blocks unsafe recovery.

POSIX journal writes use temporary-file fsync → rename → parent fsync. Windows guarantees process-crash recovery, not power-loss durability.

## Deferred follow-up

A later stacked Full PR may transport resource closure only after every resource owner provides an owner-owned consistent snapshot API. It must transport Knowledge indexes as sealed owner snapshots and may not use restore-time re-embedding as a substitute. This Lite contract deliberately exposes no Full enum, resource payload, resource install journal field, or owner registration seam.

## Source provenance

The initial implementation is a narrowing of PR #17499 (`88d37255fc`): archive admission, portable materialization, durable journal/promotion, IPC, UI, and tests were retained where they satisfy this Lite contract. Full resource/rebuild code was excluded rather than adapted.
