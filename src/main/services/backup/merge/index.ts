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
// Wiring status: the engine is landed + unit-tested (junction phase, FTS rebuild,
// FTS + app_state consistency checks) and wired into BackupService.startRestore via
// MergeEngine.mergeBackupIntoWork. Production restore stays fail-closed on the
// quiesce stub (throws RestoreQuiesceNotImplementedError before merge runs) and on
// file-resource staging until those tracks land.
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
