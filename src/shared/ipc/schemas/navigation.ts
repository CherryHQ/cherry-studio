import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Navigation IPC schemas — go somewhere in the EXISTING main window.
 *
 * SCOPE GUARD: this domain is strictly "navigate-to" — take the running main
 * window (creating it only as a delivery fallback) to a route path. It is NOT
 * "spawn-with": creating a NEW window around content (subWindow tab detach,
 * selection popups, …) takes a full payload (title/icon/metadata/…) and belongs
 * to that window's own service — e.g. SubWindowService for subWindows. A route
 * belongs here only if its input is a main-window route path and nothing else.
 *
 * Two blocks per the framework's two-axis model (see ipc-overview.md):
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

// ── Request: renderer→main calls (zod values, always parsed) ──
export const navigationRequestSchemas = {
  // Open an allowlisted route in the main window, from ANY window (the caller is
  // usually not the main window — hence the `_in_main` target qualifier). Paths
  // outside ALLOWED_ROUTE_PREFIXES (mainWindowNavigation.ts) are warn-and-dropped.
  'navigation.open_route_in_main': defineRoute({
    input: z.object({
      path: z.string()
    }),
    output: z.void()
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type NavigationEventSchemas = {
  // Sent *directed* to the main window only: a route open was requested (deep
  // link, another window, app menu). The main-window shell decides how to land
  // it (settings singleton tab vs regular openTab). Fact-style name on purpose —
  // events report what happened; requests give orders.
  'navigation.open_route_requested': { to: string }
}
