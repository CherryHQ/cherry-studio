import { application } from '@application'
import type { networkRequestSchemas } from '@shared/ipc/schemas/network'
import type { IpcHandlersFor } from '@shared/ipc/types'

const DIAGNOSE_TIMEOUT_MS = 15_000

export const networkHandlers: IpcHandlersFor<typeof networkRequestSchemas> = {
  'network.diagnose_endpoint': async ({ url }) =>
    application.get('NetworkService').diagnoseEndpoint({ id: 'custom', url }, AbortSignal.timeout(DIAGNOSE_TIMEOUT_MS))
}
