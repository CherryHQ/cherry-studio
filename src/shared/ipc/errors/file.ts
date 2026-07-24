/** File-domain IpcApi error codes. Import directly from this module on both sides. */
export const fileErrorCodes = {
  /** Default-open was blocked because the extension may execute through OS file associations. */
  OPEN_BLOCKED_UNSAFE_TYPE: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE',
  /** An optimistic file write was rejected because the on-disk version changed. */
  STALE_VERSION: 'FILE_STALE_VERSION'
} as const
