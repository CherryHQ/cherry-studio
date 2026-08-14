import { application } from '@application'
import type { apiGatewayRequestSchemas } from '@shared/ipc/schemas/apiGateway'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { ApiGatewayStatusResult } from '@shared/types/apiGateway'

/**
 * API-gateway handlers delegating to the ApiGatewayService lifecycle service. The
 * service's start/stop/restart THROW on failure; this wraps each into the
 * `ApiGatewayStatusResult` the renderer branches on (the wrapper moved here from the
 * service's own former IPC registration).
 */
async function toStatusResult(action: () => Promise<void>): Promise<ApiGatewayStatusResult> {
  try {
    await action()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const apiGatewayHandlers: IpcHandlersFor<typeof apiGatewayRequestSchemas> = {
  'api_gateway.start': () => toStatusResult(() => application.get('ApiGatewayService').start()),
  'api_gateway.stop': () => toStatusResult(() => application.get('ApiGatewayService').stop()),
  'api_gateway.restart': () => toStatusResult(() => application.get('ApiGatewayService').restart())
}
