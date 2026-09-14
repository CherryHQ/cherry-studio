import * as z from 'zod'

import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { defineRoute } from '../define'

const screenCapturePermissionStatusSchema = z.enum(['authorized', 'not-determined', 'denied'])

/**
 * System IPC schemas — host-environment queries, a caller-window devtools toggle, and
 * `system.shell.*` OS-shell integration (open a local path / external URL).
 *
 * The two `system.mac.*` accessibility routes were previously registered ONLY on darwin;
 * the IpcApi handlers are resident on every platform and return `false` off darwin (see
 * handlers/system.ts). `native_theme_updated` carries the resolved ThemeMode
 * ('dark' | 'light') as a bare string, broadcast to every window.
 *
 * The three screen-recording routes follow that same resident pattern — off darwin the
 * status is always 'authorized' and the request is a no-op, so the renderer needs no
 * platform branch. `request_screen_capture` answers with the status re-read AFTER
 * prompting rather than void: the OS prompts at most once, so the caller cannot infer the
 * outcome from the call itself, and the settings UI has to tell three cases apart —
 * granted (offer restart), still 'not-determined' (the prompt never appeared, e.g. an
 * unsigned dev binary), and denied (send the user to System Settings).
 */
export const systemRequestSchemas = {
  'system.get_device_type': defineRoute({ input: z.void(), output: z.string() }),
  'system.get_native_theme': defineRoute({
    input: z.void(),
    output: z.enum([ThemeMode.light, ThemeMode.dark])
  }),
  'system.toggle_dev_tools': defineRoute({ input: z.void(), output: z.void() }),
  'system.get_fonts': defineRoute({ input: z.void(), output: z.array(z.string()) }),
  'system.get_ip_country': defineRoute({ input: z.void(), output: z.string() }),
  'system.mac.is_process_trusted': defineRoute({ input: z.void(), output: z.boolean() }),
  'system.mac.request_process_trust': defineRoute({ input: z.void(), output: z.boolean() }),
  'system.mac.screen_capture_status': defineRoute({
    input: z.void(),
    output: screenCapturePermissionStatusSchema
  }),
  'system.mac.request_screen_capture': defineRoute({
    input: z.void(),
    output: screenCapturePermissionStatusSchema
  }),
  // Takes no input on purpose: the pane URL is a fixed constant in main, and its
  // `x-apple.systempreferences:` scheme is not one `system.shell.open_website` accepts.
  'system.mac.open_screen_capture_settings': defineRoute({ input: z.void(), output: z.void() }),
  // OS-shell integration — fire-and-forget delegations to Electron's `shell` module.
  // `open_website` screens the URL scheme in the handler before opening it externally.
  'system.shell.open_path': defineRoute({ input: z.string(), output: z.void() }),
  'system.shell.open_website': defineRoute({ input: z.string(), output: z.void() })
}

export type SystemEventSchemas = {
  'system.native_theme_updated': ThemeMode
}
