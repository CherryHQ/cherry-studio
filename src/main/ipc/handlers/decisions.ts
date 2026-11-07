import { decisionsService } from '@main/services/decisions/decisionsService'
import type { decisionsRequestSchemas } from '@shared/ipc/schemas/decisions'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const decisionsHandlers: IpcHandlersFor<typeof decisionsRequestSchemas> = {
  'decisions.create': (request) => decisionsService.create(request)
}
