import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { regionService } from '@main/services/RegionService'
import { isSafeExternalUrl } from '@main/utils/externalUrlSafety'
import { getDeviceType } from '@main/utils/system'
import type { systemRequestSchemas } from '@shared/ipc/schemas/system'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { shell, systemPreferences } from 'electron'
import fontList from 'font-list'

const logger = loggerService.withContext('systemHandlers')

/**
 * System-domain handlers. Most are stateless host-environment queries; `toggle_dev_tools`
 * acts on the caller window, resolved from `ctx.senderId` via WindowManager (the legacy
 * handler used `BrowserWindow.fromWebContents(event.sender)`).
 *
 * The two `mac.*` accessibility routes are resident on ALL platforms and short-circuit to
 * `false` off darwin — the legacy handlers were only registered inside `if (isMac)`, so a
 * non-darwin invoke used to reject; returning `false` keeps the typed surface uniform.
 * `request_process_trust` prompts the OS dialog and returns the trust state at call time.
 *
 * The `system.shell.*` routes delegate straight to Electron's `shell` and ignore
 * `IpcContext` (they act on app-level OS resources, not the caller's window). `open_website`
 * drops a URL that fails the scheme guard with a warning instead of opening it externally.
 */
export const systemHandlers: IpcHandlersFor<typeof systemRequestSchemas> = {
  'system.get_device_type': async () => getDeviceType(),
  'system.toggle_dev_tools': async (_input, { senderId }) => {
    if (!senderId) return
    application.get('WindowManager').getWindow(senderId)?.webContents.toggleDevTools()
  },
  'system.get_fonts': async () => {
    try {
      const fonts = await fontList.getFonts()
      return fonts.map((font: string) => font.replace(/^"(.*)"$/, '$1')).filter((font: string) => font.length > 0)
    } catch (error) {
      logger.error('Failed to get system fonts:', error as Error)
      return []
    }
  },
  'system.get_ip_country': async () => regionService.getCountry(),
  'system.mac.is_process_trusted': async () => (isMac ? systemPreferences.isTrustedAccessibilityClient(false) : false),
  'system.mac.request_process_trust': async () =>
    isMac ? systemPreferences.isTrustedAccessibilityClient(true) : false,
  'system.shell.open_path': async (path) => {
    await shell.openPath(path)
  },
  'system.shell.open_website': async (url) => {
    if (!isSafeExternalUrl(url)) {
      logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${url}`)
      return
    }
    await shell.openExternal(url)
  }
}
