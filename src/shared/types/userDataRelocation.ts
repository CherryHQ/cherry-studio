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

/** Recovery links the relocation window may ask main to open. The renderer never supplies the URL. */
export const UserDataRelocationSupportLinks = {
  feedback: 'mailto:support@cherry-ai.com?subject=Cherry%20Studio%20Feedback',
  releases: 'https://github.com/CherryHQ/cherry-studio/releases'
} as const

export type UserDataRelocationSupportLink = keyof typeof UserDataRelocationSupportLinks

/**
 * Bare ipcMain/ipcRenderer channels for the relocation-only launch, where the
 * lifecycle IpcApiService never starts. Same pattern as MigrationIpcChannels.
 */
export const UserDataRelocationIpcChannels = {
  GetProgress: 'user-data-relocation:get-progress',
  Restart: 'user-data-relocation:restart',
  // Feedback mailto or official releases. The renderer names a purpose; main resolves the URL.
  OpenSupportLink: 'user-data-relocation:open-support-link',
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
