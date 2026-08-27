import { localModelService } from '@main/ai/localModel'
import type { localModelRequestSchemas } from '@shared/ipc/schemas/localModel'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin IPC adapters; bundle lifecycle and shared-artifact cleanup stay in the domain service. */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_acceleration_capability': async () => ({
    supported: localModelService.isHardwareAccelerationSupported()
  }),
  'local_model.list': async () => ({ models: localModelService.listModels() }),
  'local_model.get_status': async ({ id }) => localModelService.getStatusInfo(id),
  'local_model.download': async ({ id }) => ({ result: await localModelService.download(id) }),
  'local_model.cancel': async ({ id }) => localModelService.cancel(id),
  'local_model.remove': async ({ id }) => localModelService.remove(id)
}
