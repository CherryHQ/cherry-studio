/** File-domain IpcApi error codes. Import directly from this module on both sides. */
export const fileErrorCodes = {
  /** Default-open was blocked because the extension may execute through OS file associations. */
  OPEN_BLOCKED_UNSAFE_TYPE: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE'
} as const
