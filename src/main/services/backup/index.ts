// Backup service barrel — single public door for the backup export pipeline.
//
// Per naming-conventions.md §6.4 this index.ts is a pure re-export that declares
// the directory's encapsulation boundary: outside code imports from here, never
// from an internal path (BackupService.ts / ExportOrchestrator.ts / contributors
// / errors / archive / manifest / presets / SqliteFileStager).
//
// Public surface is intentionally narrow: only the BackupService lifecycle class
// is exported, for the composition root (serviceRegistry) to register. Runtime
// callers resolve it via `application.get('BackupService')`. Internal helpers
// (ExportOrchestrator, SqliteFileStager, errors, contributors/*, …) are private to the
// pipeline and stay unexported here; in-directory .test.ts files may import them
// directly because tests are not external consumers.
//
export { BackupService } from './BackupService'
