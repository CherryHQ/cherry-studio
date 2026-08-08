/** File-domain IpcApi error codes. Import directly from this module on both sides. */
export const fileErrorCodes = {
  /** Default-open was blocked because the extension may execute through OS file associations. */
  OPEN_BLOCKED_UNSAFE_TYPE: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE',
  /** An optimistic file write was rejected because the on-disk version changed. */
  STALE_VERSION: 'FILE_STALE_VERSION',
  /** New bytes committed, but FileEntry metadata must be recovered before retrying. */
  COMMITTED_METADATA_PENDING: 'FILE_COMMITTED_METADATA_PENDING',
  /** DirectoryTreeManager shut down while the create was in flight — the UI is going away. */
  DIRECTORY_TREE_STOPPED: 'FILE_DIRECTORY_TREE_STOPPED'
} as const
