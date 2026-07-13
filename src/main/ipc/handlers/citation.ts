import { citationPreviewService } from '@main/services/CitationPreviewService'
import type { citationRequestSchemas } from '@shared/ipc/schemas/citation'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const citationHandlers: IpcHandlersFor<typeof citationRequestSchemas> = {
  'citation.fetch_preview': async ({ url }) => {
    try {
      return { content: await citationPreviewService.fetchPreview(url) }
    } catch {
      return { content: '' }
    }
  }
}
