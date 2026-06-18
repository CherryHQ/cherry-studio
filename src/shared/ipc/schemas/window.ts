import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * WindowManager IPC schemas — caller-window control operations ONLY.
 *
 * SCOPE GUARD: this domain is strictly "the renderer asks WindowManager to act on the
 * window that issued the call" (close / minimize / maximize / fullscreen / its init
 * data), addressed by `ctx.senderId`. Do NOT collect every window-ish IPC here:
 *   - opening a *named* window (settings, search, …) is a feature/navigation concern;
 *   - operating the main-window *singleton* (reload, set-minimum-size) is MainWindow's.
 * Each of those is its own domain. Keeping this file to WindowManager keeps the
 * `senderId`-addressed semantics uniform — a new route belongs here only if it acts on
 * the caller's own window via WindowManager.
 *
 * Two blocks per the framework's two-axis model (see ipc-overview.md):
 *   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
 *   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
 */

// ── Request: renderer→main calls (zod values, always parsed) ──
export const windowRequestSchemas = {
  // Fire-and-forget controls — the internal "was the window found" boolean is observed
  // by no caller, so the route output is void (see ipc-migration-guide.md, return-value
  // rule: a result with no meaning to the caller is void).
  'window.close': defineRoute({ input: z.void(), output: z.void() }),
  'window.minimize': defineRoute({ input: z.void(), output: z.void() }),
  'window.maximize': defineRoute({ input: z.void(), output: z.void() }),
  'window.unmaximize': defineRoute({ input: z.void(), output: z.void() }),
  'window.set_full_screen': defineRoute({ input: z.boolean(), output: z.void() }),
  // Queries whose result the caller reads.
  'window.is_maximized': defineRoute({ input: z.void(), output: z.boolean() }),
  'window.is_full_screen': defineRoute({ input: z.void(), output: z.boolean() }),
  // The init data WindowManager stored for the caller window; its shape varies per
  // window type, so it is opaque (unknown) and the consumer casts (see useWindowInitData).
  'window.get_init_data': defineRoute({ input: z.void(), output: z.unknown() })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
// All three are sent *directed* to the affected window (IpcApiService.send), never
// broadcast — a window only cares about its own state transitions.
export type WindowEventSchemas = {
  'window.maximized_changed': boolean
  'window.fullscreen_changed': boolean
  // Payload = the initData passed to open()/pushInitData(); opaque, consumer casts.
  'window.reused': unknown
}
