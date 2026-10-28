import { application } from '@application'
import { regionService } from '@main/services/RegionService'
import type { localModelRequestSchemas } from '@shared/ipc/schemas/localModel'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin IPC adapters; bundle lifecycle and shared-artifact cleanup stay in the domain service. */
export const localModelHandlers: IpcHandlersFor<typeof localModelRequestSchemas> = {
  'local_model.get_acceleration_capability': async () => ({
    supported: application.get('LocalModelService').isHardwareAccelerationSupported()
  }),
  'local_model.list': async () => ({ models: application.get('LocalModelService').listModels() }),
  'local_model.get_status': async ({ id }) => application.get('LocalModelService').refreshStatus(id),
  'local_model.download': async ({ id }) => ({
    result: await application
      .get('LocalModelService')
      .download(id, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
  }),
  'local_model.cancel': async ({ id }) => application.get('LocalModelService').cancel(id),
  'local_model.remove': async ({ id }) => application.get('LocalModelService').remove(id)
}
