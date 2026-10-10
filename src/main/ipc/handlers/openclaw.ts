import { application } from '@application'
import type { openclawRequestSchemas } from '@shared/ipc/schemas/openclaw'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { OperationResult } from '@shared/types/codeTools'

/** Run a gateway operation, turning a thrown error into a failed OperationResult. */
async function asOperationResult(fn: () => Promise<OperationResult>): Promise<OperationResult> {
  try {
    return await fn()
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const openclawHandlers: IpcHandlersFor<typeof openclawRequestSchemas> = {
  'openclaw.start_gateway': (input) =>
    asOperationResult(() => application.get('OpenClawService').startGateway(input.port)),
  'openclaw.stop_gateway': () => asOperationResult(() => application.get('OpenClawService').stopGateway()),
  'openclaw.get_status': async () => {
    // The renderer owns the gateway port (via preference) and only consumes status here, so keep
    // getStatus()'s port off the wire — the router does not re-parse handler output.
    const { status } = await application.get('OpenClawService').getStatus()
    return { status }
  },
  'openclaw.get_dashboard_url': async () => {
    return application.get('OpenClawService').getDashboardUrl()
  },
  'openclaw.sync_config': (input) =>
    asOperationResult(() => application.get('OpenClawService').syncConfig(input.uniqueModelId, input.port))
}
