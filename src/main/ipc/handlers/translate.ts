import { application } from '@application'
import { translateService } from '@main/services/translate/translateService'
import type { translateRequestSchemas } from '@shared/ipc/schemas/translate'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

function senderWebContents(senderId: WindowId | null): Electron.WebContents | undefined {
  if (senderId == null) return undefined
  return application.get('WindowManager').getWindow(senderId)?.webContents
}

/**
 * Opens a streaming translation. Delegates to the translateService singleton, resolving the
 * caller's WebContents from `ctx.senderId` — the service streams chunks directly to it via
 * the shared `ai.stream_*` events. Returns the `streamId` the renderer filters those by.
 */
export const translateHandlers: IpcHandlersFor<typeof translateRequestSchemas> = {
  'translate.open': async (request, { senderId }) => {
    const wc = senderWebContents(senderId)
    if (!wc) throw new Error('translate.open requires a managed window')
    return translateService.open(wc, request)
  }
}
