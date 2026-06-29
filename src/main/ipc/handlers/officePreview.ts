import { officePreviewService } from '@main/services/OfficePreviewService'
import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type { officePreviewRequestSchemas } from '@shared/ipc/schemas/officePreview'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const officePreviewHandlers: IpcHandlersFor<typeof officePreviewRequestSchemas> = {
  'office_preview.render': async (input, { senderId }) => {
    if (!senderId) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }
    return officePreviewService.render(input)
  }
}
