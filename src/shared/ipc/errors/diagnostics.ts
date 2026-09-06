/** Diagnostics-domain IpcApi error codes. Import directly from this module on both sides. */
export const diagnosticsErrorCodes = {
  /** The diagnostic archive could not be assembled. */
  BUNDLE_BUILD_FAILED: 'DIAGNOSTICS_BUNDLE_BUILD_FAILED',
  /** The selected destination resolves inside a directory that supplies diagnostic data. */
  DESTINATION_INSIDE_SOURCE: 'DIAGNOSTICS_DESTINATION_INSIDE_SOURCE',
  /** The selected destination is the same physical file as a diagnostic source. */
  DESTINATION_IS_SOURCE: 'DIAGNOSTICS_DESTINATION_IS_SOURCE',
  /** A retained upload could not be saved to the user-selected path. */
  FALLBACK_SAVE_FAILED: 'DIAGNOSTICS_FALLBACK_SAVE_FAILED',
  /** The requested preserved archive is not available for retry in this process. */
  RETRY_NOT_AVAILABLE: 'DIAGNOSTICS_RETRY_NOT_AVAILABLE'
} as const
