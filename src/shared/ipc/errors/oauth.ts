/** OAuth-domain IpcApi error codes. Import directly from this module on both sides. */
export const oauthErrorCodes = {
  SIGN_IN_FAILED: 'OAUTH_SIGN_IN_FAILED',
  /** The user cancelled a pending browser authorization flow. */
  SIGN_IN_CANCELLED: 'OAUTH_SIGN_IN_CANCELLED'
} as const
