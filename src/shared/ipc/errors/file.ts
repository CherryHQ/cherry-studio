/** File-domain IpcApi error codes. Import directly from this module on both sides. */
export const fileErrorCodes = {
  /** Default-open was blocked because the extension may execute through OS file associations. */
  OPEN_BLOCKED_UNSAFE_TYPE: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE',
  /** The file cannot be edited by the UTF-8 text editor without changing its semantics. */
  TEXT_EDIT_UNSUPPORTED: 'FILE_TEXT_EDIT_UNSUPPORTED',
  /** The file changed after the caller's editable snapshot was read. */
  TEXT_EDIT_STALE: 'FILE_TEXT_EDIT_STALE'
} as const
