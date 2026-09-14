import { application } from '@application'
import type { webviewRequestSchemas } from '@shared/ipc/schemas/webview'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Webview-domain handlers acting on a MiniApp `<webview>` guest by its webContents id.
 * Guest operations delegate to WebviewService, which validates the caller before
 * touching the WebContents.
 */
export const webviewHandlers: IpcHandlersFor<typeof webviewRequestSchemas> = {
  'webview.set_open_link_external': async ({ webviewId, isExternal }, { senderId }) =>
    application.get('WebviewService').setOpenLinkExternal(webviewId, isExternal, senderId),
  'webview.set_spell_check_enabled': async ({ webviewId, isEnable }, { senderId }) =>
    application.get('WebviewService').setSpellCheckerEnabled(webviewId, isEnable, senderId),
  'webview.export_annotations': async (input, { senderId }) =>
    application.get('WebviewService').exportAnnotations(input, senderId),
  'webview.print_to_pdf': async ({ webviewId }, { senderId }) =>
    application.get('WebviewService').printWebviewToPDF(webviewId, senderId),
  'webview.save_as_html': async ({ webviewId }, { senderId }) =>
    application.get('WebviewService').saveWebviewAsHTML(webviewId, senderId)
}
