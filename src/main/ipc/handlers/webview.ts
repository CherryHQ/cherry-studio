import { application } from '@application'
import { setOpenLinkExternal } from '@main/services/WebviewService'
import type { webviewRequestSchemas } from '@shared/ipc/schemas/webview'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { webContents } from 'electron'

/**
 * Webview-domain handlers acting on a MiniApp `<webview>` guest by its webContents id.
 * The stateless link/spellcheck toggles run inline; the dialog-driven print/save flows
 * delegate to WebviewService (which owns the save-dialog + file-write logic and throws
 * 'Webview not found' when the guest is gone).
 */
export const webviewHandlers: IpcHandlersFor<typeof webviewRequestSchemas> = {
  'webview.set_open_link_external': async ({ webviewId, isExternal }) => {
    setOpenLinkExternal(webviewId, isExternal)
  },
  'webview.set_spell_check_enabled': async ({ webviewId, isEnable }) => {
    webContents.fromId(webviewId)?.session.setSpellCheckerEnabled(isEnable)
  },
  'webview.print_to_pdf': async ({ webviewId }) => application.get('WebviewService').printWebviewToPDF(webviewId),
  'webview.save_as_html': async ({ webviewId }) => application.get('WebviewService').saveWebviewAsHTML(webviewId)
}
