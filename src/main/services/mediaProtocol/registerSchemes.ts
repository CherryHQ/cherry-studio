import { protocol } from 'electron'

import { CHERRY_MEDIA_SCHEME } from './types'

/**
 * Declare the media scheme as privileged. MUST run before `app.whenReady()`
 * resolves — `protocol.registerSchemesAsPrivileged` may only be called once
 * per process and throws once the app is ready.
 *
 * Privileges:
 * - `standard`  — URLs parse with host + path, giving the handler a kind segment.
 * - `secure`    — treated as a secure origin, so it is not blocked in the overlay.
 * - `supportFetchAPI` + `corsEnabled` — every consumer fetches the capture as a
 *   Blob and renders it through an object URL, which is what keeps the canvas
 *   untainted. A corsEnabled scheme served via `protocol.handle` needs no
 *   `Access-Control-Allow-Origin` header, so the handler returns none.
 *
 * No `stream` — it exists for range-requested audio/video, and this scheme
 * currently carries only images. Add it together with the first media kind that
 * needs it, not in anticipation.
 */
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CHERRY_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}
