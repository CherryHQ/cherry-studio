# Agent Note: Child history revision and serial child residency

Status: implemented

English | [中文](2026-11-20-agent-child-history-revision.zh.md)

## Problem

[Child residency](2026-11-19-agent-child-residency.md) marks a released child settled when its [work state](2026-11-19-agent-subagent-work-state.md) reads `idle` after the final flush. That sample is edge-triggered and lossy:

- Work that resumes and finishes while the flush or the native handle release is still running leaves the marker on rows that miss the new history.
- A Pi or Pi Durable feed overflow can collapse a child's `running` between two `idle` snapshots, so the host never sees the child work again.
- A cold reopen trusts the marker without any check against native history.

The residency also runs each child's operations concurrently: relate, open, release, restore, pins, commands and release retries. They coordinate by checking the entry state again after every await. Each review round found another interleaving, for example a restore racing a parent release, a settle after work resumed, an open racing a redundant handle release, and concurrent release retries. More checks would keep the same structure, and with it the same class of race.

## Decision

- `Subagent.revision?: number` in `packages/agent-runtime/src/contracts.ts` grows with the child's committed native history. A later archive read of the child reports at least the revision that an earlier relationship carried. Owners include it on a relationship whenever they can read it without loading the child, and each child archive read reports the revision it covers (`CommittedHistory.revision` in Main).
- **Claude Code:** the owner's latest archive read records each child's raw transcript entry count. A child whose projection received a live frame after that read (`ClaudeProjection.liveSinceRead`) reports no revision, either on relationships or on archive reads made without a refresh, until the next read.
- **Pi:** the child session's branch length. `onWork` publishes it with every work change of a loaded child, and the child's open publishes it on its relationship. Relationships replayed on a root reopen omit it.
- **Pi Durable:** `latestEntryId` of the child conversation, the head the archive read already uses. Relationship reads (`readChildState`) and work changes (`publishWork`) report it, as does the close-time archive cache.
- `ChildResidency` keeps one record per child: its desired state (work evidence, pins, how to open it, a granted handle) and its actual state (phase, loaded resource, saved rows). Each record has one `createLatestReconciler`. `relate`, `pin`, `command` and `open` only change the desired state and request a pass. The reconciler alone loads, releases, or retries a failed release, one step per pass, and decides each step from the state current at that step.
- A release flushes, then writes `settled` with `settledRevision`, the revision the final flush read (`ChildThreadProjection.revision`), when the child is still idle. A released child reloads when a relationship reports work other than `idle`, or a revision newer than its saved one when both are known. Restores of unseen or outdated idle children run one at a time. Each one waits for the restored child's release and for the parent releases that release sets off.

## Alternatives considered

- **Keep checking the state again after every await.** Every review round found a new interleaving; a single writer per child removes the class.
- **Compare revisions only from archive reads.** A cold reopen would have to load every child to compare, which is the cost child residency removes.
- **Use the Pi Durable commit sequence (`Seq`).** Relating an entry to its commit needs an extra lookup per read. The archive already reads the newest entry ID, so the entry ID serves the same purpose.
- **Count live Claude frames as revision.** Live frames do not map one to one onto transcript entries, so the count would drift from what an archive read reports, and the next replay would reload every child.

## Consequences

- Restored children, and children whose relationship carries a revision, settle at an exact revision. Later history in them is detected from the relationship alone, including history that a lost `running` event hid.
- Claude Code children that ran live settle without a revision, and Pi children on a root reopen report none. Both still depend on work state alone. A crash after a child commits resumed work, but before the host clears its marker, leaves stale rows until the child is opened.
- Pi and Pi Durable still publish a relationship change only when work changes; the revision rides on those changes.
- Pi Durable reads the newest entry ID on every child work change.
- A caller of `open` that passes a redundant granted handle releases it after the child's pending steps finish, not before.

## Verification

- AC1 — `pnpm test:agent-runtime-claude-code`, `pnpm test:agent-runtime-pi` and `pnpm test:agent-runtime-pi-durable` pass. The Claude test "continues the same child with a new native run" checks that a replayed relationship's revision equals the child's archive read. The Pi tests "continues an observed child through its owner, keeps one relationship, and reports the new run once" and "restores child relations on reopen and refuses a child without its live owner" check that a loaded child reports a revision that grows with its continuation and is covered by its archive. The Durable test "discovers native forks and archives only child-owned output independently of the parent" checks that a replay after continuation reports a larger revision that the child's archive covers.
- AC2 — `ChildResidency.test.ts` "reloads a released child when a relationship reports a newer revision than its final flush read": an equal revision leaves the child released, and a newer one reloads it and saves the new revision.
- AC3 — `ChildResidency.test.ts` "restores a settled child on reopen only when its native revision is newer than the saved one".
- AC4 — The Claude test "continues the same child with a new native run" checks that, after the live continuation, the relationship and the archive read without a refresh report no revision, and that the next refresh reports a larger one.
- AC5 — The 15 earlier `ChildResidency.test.ts` race tests pass on the reconciler. "returns the current child when it releases while a redundant handle closes" now waits for the redundant release to start, because that release follows the child's pending steps. `pnpm typecheck:node` passes, and `pnpm test:main` over the 24 connection, projection and context-service test files passes (719 tests, 2 skipped).
