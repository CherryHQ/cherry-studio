import { officePreviewService } from '@main/services/OfficePreviewService'
import type { officePreviewRequestSchemas } from '@shared/ipc/schemas/officePreview'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const officePreviewHandlers: IpcHandlersFor<typeof officePreviewRequestSchemas> = {
  'office_preview.render': async (input, { senderId }) => {
    if (!senderId) {
      return { status: 'error', code: 'invalid_request' }
    }
    return officePreviewService.render(input)
  }
}
