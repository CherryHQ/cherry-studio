/** File-domain IpcApi error codes. Import directly from this module on both sides. */
export const fileErrorCodes = {
  EDIT_TARGET_CHANGED: 'FILE_EDIT_TARGET_CHANGED',
  EDIT_LEASE_CLOSED: 'FILE_EDIT_LEASE_CLOSED',
  EDIT_INVALID_SEQUENCE: 'FILE_EDIT_INVALID_SEQUENCE',
  EDIT_UNSUPPORTED: 'FILE_EDIT_UNSUPPORTED',
  EDIT_READ_UNSTABLE: 'FILE_EDIT_READ_UNSTABLE',
  EDIT_LIMIT: 'FILE_EDIT_LIMIT',
  EDIT_MISSING: 'FILE_EDIT_MISSING',
  EDIT_PERMISSION: 'FILE_EDIT_PERMISSION',
  EDIT_NO_SPACE: 'FILE_EDIT_NO_SPACE',
  EDIT_IO: 'FILE_EDIT_IO',

  /** Default-open was blocked because the extension may execute through OS file associations. */
  OPEN_BLOCKED_UNSAFE_TYPE: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE',
  /** Default-open was refused because the target is not an existing absolute path. `data.reason` narrows it. */
  OPEN_TARGET_UNAVAILABLE: 'FILE_OPEN_TARGET_UNAVAILABLE',
  /** An optimistic file write was rejected because the on-disk version changed. */
  STALE_VERSION: 'FILE_STALE_VERSION',
  /** New bytes committed, but FileEntry metadata must be recovered before retrying. */
  COMMITTED_METADATA_PENDING: 'FILE_COMMITTED_METADATA_PENDING',
  /** DirectoryTreeManager shut down while the create was in flight — the UI is going away. */
  DIRECTORY_TREE_STOPPED: 'FILE_DIRECTORY_TREE_STOPPED'
} as const
