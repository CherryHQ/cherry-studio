/** Cherry Cloud domain IpcApi error codes. Import directly on both sides of the IPC boundary. */
export const cherryCloudErrorCodes = {
  SIGN_IN_FAILED: 'CHERRY_CLOUD_SIGN_IN_FAILED',
  LOGIN_SERVICE_UNAVAILABLE: 'CHERRY_CLOUD_LOGIN_SERVICE_UNAVAILABLE',
  UPGRADE_REQUIRED: 'CHERRY_CLOUD_UPGRADE_REQUIRED'
} as const
