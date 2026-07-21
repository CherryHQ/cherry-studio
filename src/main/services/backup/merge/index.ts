// Barrel for the backup merge engine module — the detached restore import pipeline.
//
// Re-exports the engine's public API only: the engine entry, its result/context types, and the
// strategy/consistency errors. Internal helpers (FtsCentralHelper, deriveJunctionDescriptors,
// JunctionDescriptor/JunctionEndpoint, physical-column casing, scan/insert/junction privates)
// stay sealed here — MergeEngine imports them directly across module-internal boundaries; the
// barrel does not publish them (no production consumer outside this directory exists yet).
// Deep imports into individual files are disallowed by the main-process architecture rule
// (Naming Conventions §6.4 — a topic directory's index.ts is the boundary).
//
// Wiring status: the engine is landed + unit-tested (FIELD_MERGE/SKIP decisions, junction
// phase, dangling-ref repair, fileId soft-ref disclosure, FTS rebuild, FTS + app_state
// consistency checks) and wired into BackupService.startRestore via
// MergeEngine.mergeBackupIntoWork under partial quiesce. File-resource staging is still
// deferred (DB-only journal).
//
// No logic, no `export *` — only curated re-exports.

export { MergeConsistencyCheckError, MergeEngine, MergeStrategyNotImplementedError } from './MergeEngine'
export type {
  AggregateDecision,
  DegradedSkip,
  IdentityMap,
  MergeAction,
  MergeBackupIntoWork,
  MergeContext,
  MergeResult
} from './types'
