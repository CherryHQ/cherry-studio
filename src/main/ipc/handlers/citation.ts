import { application } from '@application'
import type { citationRequestSchemas } from '@shared/ipc/schemas/citation'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const citationHandlers: IpcHandlersFor<typeof citationRequestSchemas> = {
  'citation.fetch_preview': async ({ url, requestId }, { senderId }) => {
    try {
      return {
        content: await application.get('CitationPreviewService').fetchPreview(url, { requestId, senderId })
      }
    } catch {
      return { content: '' }
    }
  },
  'citation.cancel_previews': async ({ requestId }, { senderId }) => {
    application.get('CitationPreviewService').cancelPreviews({ requestId, senderId })
  }
}
