import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * System IPC schemas — host-environment queries, a caller-window devtools toggle, and
 * `system.shell.*` OS-shell integration (open a local path / external URL).
 *
 * The two `system.mac.*` accessibility routes were previously registered ONLY on darwin;
 * the IpcApi handlers are resident on every platform and return `false` off darwin (see
 * handlers/system.ts). `native_theme_updated` carries the resolved ThemeMode
 * ('dark' | 'light') as a bare string, broadcast to every window.
 */
export const systemRequestSchemas = {
  'system.get_device_type': defineRoute({ input: z.void(), output: z.string() }),
  'system.toggle_dev_tools': defineRoute({ input: z.void(), output: z.void() }),
  'system.get_fonts': defineRoute({ input: z.void(), output: z.array(z.string()) }),
  'system.get_ip_country': defineRoute({ input: z.void(), output: z.string() }),
  'system.mac.is_process_trusted': defineRoute({ input: z.void(), output: z.boolean() }),
  'system.mac.request_process_trust': defineRoute({ input: z.void(), output: z.boolean() }),
  // OS-shell integration — fire-and-forget delegations to Electron's `shell` module.
  // `open_website` screens the URL scheme in the handler before opening it externally.
  'system.shell.open_path': defineRoute({ input: z.string(), output: z.void() }),
  'system.shell.open_website': defineRoute({ input: z.string(), output: z.void() })
}

export type SystemEventSchemas = {
  'system.native_theme_updated': ThemeMode
}
