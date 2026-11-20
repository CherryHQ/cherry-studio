# Agent Note: Child history revision and serial child residency

Status: proposed

English | [中文](2026-11-20-agent-child-history-revision.zh.md)

## Problem

[Child residency](2026-11-19-agent-child-residency.md) marks a released child settled when its [work state](2026-11-19-agent-subagent-work-state.md) reads `idle` after the final flush. That sample is edge-triggered and lossy:

- Work that resumes and finishes while the flush or the native handle release is still running leaves the marker on rows that miss the new history.
- A Pi or Pi Durable feed overflow can collapse a child's `running` between two `idle` snapshots, so the host never sees the child work again.
- A cold reopen trusts the marker without any check against native history.

The residency also runs each child's operations concurrently: relate, open, release, restore, pins, commands and release retries. They coordinate by checking the entry state again after every await. Each review round found another interleaving, for example a restore racing a parent release, a settle after work resumed, an open racing a redundant handle release, and concurrent release retries. More checks would keep the same structure, and with it the same class of race.

## Proposal

### Contract

`Subagent` in `packages/agent-runtime/src/contracts.ts` gains an optional revision:

```ts
export interface Subagent {
  // id, parent, child, origin, work as before
  /** A count that grows with the child's committed native history. */
  readonly revision?: number
}
```

- A later archive read of the child reports at least the revision that an earlier relationship carried, so a reload never loops.
- An owner includes the revision on a relationship whenever it can read it without loading the child. Each child archive read reports the revision it covers.

Evidence per adapter:

- **Claude Code:** the child's raw transcript entry count at the owner's latest archive read; transcripts only append. A child that received a live frame after that read reports no revision until the next read, because live SDK frames do not map one to one onto transcript entries.
- **Pi:** the child session's branch length; a child's branch only grows. Loaded children report it on every work change. Relationships replayed on a root reopen omit it, because those children are not loaded.
- **Pi Durable:** the newest entry ID visible from the child conversation (`latestEntryId`, the head the archive already reads); entry IDs only grow. Every relationship read and every work change reports it.

### Host

- The settled marker records `checkpointMapping.child.settledRevision`: the revision of the final flush's archive read.
- A released child reloads when its relationship reports work other than `idle`, or a revision newer than `settledRevision` when both are known. An equal or unknown revision leaves it released. The reloaded child flushes and settles at the new revision.
- Each child has one serial reconciler (`createLatestReconciler`). Relationships, pins, commands and opens only update the child's desired state (work evidence, pins and how to open it) and request a pass. The reconciler alone opens, releases, and retries a failed release, one step at a time, and it decides each step from the state current at that step.
- Restores of unseen or outdated idle children still run one at a time. Each one waits for the restored child's release and for the parent releases that release sets off.

## Alternatives considered

- **Keep checking the state again after every await.** Every review round found a new interleaving; a single writer per child removes the class.
- **Compare revisions only from archive reads.** A cold reopen would have to load every child to compare, which is the cost child residency removes.
- **Use the Pi Durable commit sequence (`Seq`).** Relating an entry to its commit needs an extra lookup per read. The archive already reads the newest entry ID, so the entry ID serves the same purpose.
- **Count live Claude frames as revision.** Live frames do not map one to one onto transcript entries, so the count would drift from what an archive read reports, and the next replay would reload every child.

## Acceptance criteria

- AC1 — Claude Code, Pi and Pi Durable child archive reads report a revision, and relationships carry one where the owner reads it without loading the child (verification: unit)
- AC2 — A released child whose relationship reports a newer revision than its saved rows reloads and settles at that revision; an equal revision leaves it released (verification: unit)
- AC3 — A cold reopen leaves a settled child unloaded unless its native revision is newer than the saved one (verification: unit)
- AC4 — A Claude Code child that received live frames after the latest archive read reports no revision, so a later archive replay does not restore a child that settled after its live run (verification: unit)
- AC5 — Each child's opens, releases and release retries run one at a time through its reconciler, and the residency race tests from the earlier reviews still pass (verification: unit)

## Risks

- An owner that reports a relationship revision above its own archive read would reload the child on every replay of that relationship.
- Claude Code children that ran live, and Pi children on a root reopen, still depend on work state alone. A crash after a child commits resumed work, but before the host clears its marker, leaves stale rows until the child is opened.
- Pi Durable reads the newest entry ID on every child work change.
