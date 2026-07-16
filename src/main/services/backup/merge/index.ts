// Barrel for the backup merge engine module — the detached restore import pipeline.
//
// Re-exports the cohesive public API only: the engine entry, its result/context
// types, and the strategy/consistency errors. Internal helpers (physical-column
// casing, FTS-derived-column strip, scan/insert privates) stay sealed here. Deep
// imports into individual files are disallowed by the main-process architecture
// rule (Naming Conventions §6.4 — a topic directory's index.ts is the boundary).
//
// Wiring status (Stage 3 deferred): the engine is landed + unit-tested but NOT yet
// wired into the restore spine — BackupService.startRestore still throws
// RestoreMergeNotImplementedError and ImportOrchestrator retains the 2-arg
// mergeBackupIntoWork stub. Wiring (signature widening + domains/strategy/
// skippedFileEntryIds plumbing) lands in task `merge-engine-spine-wiring`. Until
// then the barrel's only consumer is this module's own test; the engine is fail-
// closed in production BY CONSTRUCTION (no caller reaches it), so exposing these
// types now is not speculative — it is the contract the Stage 3 wiring will consume.
//
// No logic, no `export *` — only curated re-exports.

export { MergeConsistencyCheckError, MergeEngine, MergeStrategyNotImplementedError } from './MergeEngine'
export type {
  AggregateDecision,
  DegradedSkip,
  IdentityMap,
  JunctionDescriptor,
  JunctionEndpoint,
  MergeAction,
  MergeBackupIntoWork,
  MergeContext,
  MergeResult
} from './types'
