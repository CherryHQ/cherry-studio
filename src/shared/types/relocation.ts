export const RelocationIpcChannels = {
  GetProgress: 'relocation:get-progress',
  Progress: 'relocation:progress',
  Restart: 'relocation:restart'
} as const

export const USER_DATA_RELOCATION_VALIDATION_REASONS = [
  'source_missing',
  'target_root',
  'same_path',
  'target_inside_source',
  'target_contains_source',
  'target_inside_install',
  'target_parent_unwritable',
  'target_not_directory',
  'target_top_level_not_empty',
  'target_in_use',
  'target_not_empty',
  'target_missing',
  'target_work_conflict'
] as const

export type UserDataRelocationValidationReason = (typeof USER_DATA_RELOCATION_VALIDATION_REASONS)[number]

export type UserDataRelocationInspection =
  | { valid: true; targetExists: boolean; targetEmpty: boolean }
  | { valid: false; reason: UserDataRelocationValidationReason }

export type RelocationStage = 'preparing' | 'copying' | 'committing' | 'completed' | 'failed'

export interface RelocationProgress {
  stage: RelocationStage
  from: string
  to: string
  copy: boolean
  bytesCopied: number
  bytesTotal: number
  error?: string
}
