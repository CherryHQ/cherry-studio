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
  },
  'translate.pdf.start': async (request, { senderId }) => {
    if (!senderId) throw new Error('translate.pdf.start requires a managed window')
    return application.get('PdfTranslationService').translate(
      request,
      (stage) => {
        application.get('IpcApiService').send(senderId, 'translate.pdf.stage', { jobId: request.jobId, stage })
      },
      (progress) => {
        application.get('IpcApiService').send(senderId, 'translate.pdf.progress', {
          jobId: request.jobId,
          ...progress
        })
      }
    )
  },
  'translate.pdf.cancel': async ({ jobId }, { senderId }) => {
    if (!senderId) throw new Error('translate.pdf.cancel requires a managed window')
    application.get('PdfTranslationService').cancel(jobId)
  },
  'translate.pdf.cleanup': async ({ jobId }, { senderId }) => {
    if (!senderId) throw new Error('translate.pdf.cleanup requires a managed window')
    await application.get('PdfTranslationService').cleanup(jobId)
  }
}
