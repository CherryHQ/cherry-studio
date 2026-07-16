// Barrel for the backup merge engine module — the detached restore import pipeline.
//
// Re-exports the cohesive public API only: the engine entry, its result/context
// types, and the strategy/consistency errors. Internal helpers (physical-column
// casing, FTS-derived-column strip, scan/insert privates) stay sealed here. Deep
// imports into individual files are disallowed by the main-process architecture
// rule (Naming Conventions §6.4 — a topic directory's index.ts is the boundary).
//
// Wiring status: the engine is landed + unit-tested and is now wired into the restore
// spine via BackupService.startRestore (which calls `new MergeEngine(registry).mergeBackupIntoWork`
// inside ImportOrchestrator.importBackup). The MergeContext carries backupDbPath + domains +
// skippedFileEntryIds (+ optional userStrategy override); MergeResult reports degradedToSkips
// for the BackupService-owned sidecar. Package restore is still fail-closed because the
// upstream quiesce/staging deps throw — MergeEngine only runs once a clean JobManager drain
// completes, so a packaged restore never reaches this code path until #17014 lands.
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
