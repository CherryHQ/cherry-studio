/** Skill-domain IpcApi error codes. Import directly from this module on both sides. */
export const skillErrorCodes = {
  /** The installed Skill is not backed by a supported, exact remote source. */
  REMOTE_UNSUPPORTED: 'SKILL_REMOTE_UNSUPPORTED',
  /** The checked remote/local revision no longer matches the apply request. */
  REMOTE_STALE: 'SKILL_REMOTE_STALE',
  /** Applying without an explicit overwrite would discard local maintenance. */
  REMOTE_LOCAL_CHANGES: 'SKILL_REMOTE_LOCAL_CHANGES'
} as const
