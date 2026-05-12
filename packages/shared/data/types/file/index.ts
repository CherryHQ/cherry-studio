export * from './essential'
export * from './fileEntry'
export * from './ref'

// FILE_TYPE / FileType / FileTypeSchema live in `@shared/file/types`. Re-export
// from this namespace too because dozens of pre-existing v2 consumers (in
// fileProcessing, knowledge, FileProcessingTaskService, …) import them via
// `@shared/data/types/file`. The legacy `FileMetadata` shape lives in
// `./legacyFileMetadata.ts` and is intentionally NOT re-exported — v2 code
// uses `FileEntry`; the migration path imports `FileMetadata` from the legacy
// module directly.
export { FILE_TYPE, type FileType, FileTypeSchema } from '@shared/file/types'
