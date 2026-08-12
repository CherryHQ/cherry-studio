/** Diagnostics-domain IpcApi error codes. Import directly from this module on both sides. */
export const diagnosticsErrorCodes = {
  /** The diagnostic archive could not be assembled. */
  BUNDLE_BUILD_FAILED: 'DIAGNOSTICS_BUNDLE_BUILD_FAILED',
  /** The selected destination resolves inside a directory that supplies diagnostic data. */
  DESTINATION_INSIDE_SOURCE: 'DIAGNOSTICS_DESTINATION_INSIDE_SOURCE',
  /** The selected destination is the same physical file as a diagnostic source. */
  DESTINATION_IS_SOURCE: 'DIAGNOSTICS_DESTINATION_IS_SOURCE',
  /** A failed or uncertain upload could not be preserved for manual recovery. */
  FALLBACK_SAVE_FAILED: 'DIAGNOSTICS_FALLBACK_SAVE_FAILED',
  /** An upload may have succeeded, but its local recovery copy could not be preserved. */
  SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED: 'DIAGNOSTICS_SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED'
} as const
