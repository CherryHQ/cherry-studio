import { CHERRY_MEDIA_SCHEME } from './types'

/**
 * Privileged-scheme declaration for the media protocol. Composed with every other
 * scheme's declaration in `main.ts` and registered there in one call:
 * `registerSchemesAsPrivileged` may only run once per process and throws once the
 * app is ready. Privileges unchanged from the `registerMediaSchemes` this replaces —
 * see git history for why each one is here.
 */
export const CHERRY_MEDIA_SCHEME_DECLARATION = {
  scheme: CHERRY_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
} as const
