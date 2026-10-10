export const USER_DATA_RELOCATION_VALIDATION_REASONS = [
  'source_missing',
  'target_root',
  'same_path',
  'target_inside_source',
  'target_contains_source',
  'target_protected',
  'target_not_absolute',
  'target_parent_unwritable',
  'target_not_directory',
  'target_in_use',
  'target_not_empty',
  'target_missing',
  'target_work_conflict'
] as const

export type UserDataRelocationValidationReason = (typeof USER_DATA_RELOCATION_VALIDATION_REASONS)[number]

export type UserDataRelocationInspection =
  | { valid: true; targetEmpty: boolean }
  | { valid: false; reason: UserDataRelocationValidationReason }

/**
 * Bare ipcMain/ipcRenderer channels for the relocation-only launch, where the
 * lifecycle IpcApiService never starts. Same pattern as MigrationIpcChannels.
 */
export const UserDataRelocationIpcChannels = {
  GetProgress: 'user-data-relocation:get-progress',
  Restart: 'user-data-relocation:restart',
  // Main -> Renderer progress event
  Progress: 'user-data-relocation:progress'
} as const

export type RelocationStage = 'preparing' | 'copying' | 'committing' | 'completed' | 'failed'

export interface RelocationProgress {
  stage: RelocationStage
  from: string
  to: string
  bytesCopied: number
  bytesTotal: number
  error?: string
}
