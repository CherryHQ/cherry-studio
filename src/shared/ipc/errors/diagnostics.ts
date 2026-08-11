/** Diagnostics-domain IpcApi error codes. Import directly from this module on both sides. */
export const diagnosticsErrorCodes = {
  /** The selected destination resolves inside a directory that supplies diagnostic data. */
  DESTINATION_INSIDE_SOURCE: 'DIAGNOSTICS_DESTINATION_INSIDE_SOURCE',
  /** The selected destination is the same physical file as a diagnostic source. */
  DESTINATION_IS_SOURCE: 'DIAGNOSTICS_DESTINATION_IS_SOURCE'
} as const
