import { officePreviewService } from '@main/services/officePreview'
import type { officePreviewRequestSchemas } from '@shared/ipc/schemas/officePreview'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const officePreviewHandlers: IpcHandlersFor<typeof officePreviewRequestSchemas> = {
  'office_preview.render': async (input) => officePreviewService.render(input)
}
