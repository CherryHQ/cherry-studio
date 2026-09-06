import { application } from '@application'
import type { apiGatewayRequestSchemas } from '@shared/ipc/schemas/apiGateway'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { ApiGatewayRuntimeAddress, ApiGatewayStatusResult, ApiGatewayStopResult } from '@shared/types/apiGateway'

/**
 * API-gateway handlers delegating to the ApiGatewayService lifecycle service. Each service method
 * throws on failure; stop also returns whether shutdown completed or is deferred by a lease.
 */
async function toStatusResult(action: () => Promise<ApiGatewayRuntimeAddress>): Promise<ApiGatewayStatusResult> {
  try {
    const address = await action()
    return { success: true, address }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function stopGateway(): Promise<ApiGatewayStopResult> {
  try {
    const outcome = await application.get('ApiGatewayService').stop()
    return { success: true, outcome }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const apiGatewayHandlers: IpcHandlersFor<typeof apiGatewayRequestSchemas> = {
  'api_gateway.get_runtime_address': async () => application.get('ApiGatewayService').getRuntimeAddress(),
  'api_gateway.start': () => toStatusResult(() => application.get('ApiGatewayService').start()),
  'api_gateway.stop': stopGateway,
  'api_gateway.restart': () => toStatusResult(() => application.get('ApiGatewayService').restart())
}
