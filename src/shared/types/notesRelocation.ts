export const NOTES_RELOCATION_VALIDATION_REASONS = [
  'source_missing',
  'source_not_directory',
  'same_path',
  'target_inside_source',
  'target_contains_source',
  'invalid_target',
  'target_not_writable'
] as const

export type NotesRelocationValidationReason = (typeof NOTES_RELOCATION_VALIDATION_REASONS)[number]

export interface NotesDirectoryStats {
  markdownFileCount: number
  folderCount: number
  totalBytes: number
}

export type NotesRelocationInspection =
  | {
      valid: true
      source: NotesDirectoryStats
      target: NotesDirectoryStats
      targetHasMarkdown: boolean
    }
  | { valid: false; reason: NotesRelocationValidationReason }

export interface NotesRelocationResult {
  source: NotesDirectoryStats
  target: NotesDirectoryStats
}
