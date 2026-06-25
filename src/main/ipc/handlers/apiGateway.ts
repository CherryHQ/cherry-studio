import { application } from '@application'
import type { apiGatewayRequestSchemas } from '@shared/ipc/schemas/apiGateway'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapters: delegate to ApiGatewayService, wrapping errors as status results. */
export const apiGatewayHandlers: IpcHandlersFor<typeof apiGatewayRequestSchemas> = {
  'api_gateway.start': async () => {
    try {
      await application.get('ApiGatewayService').start()
      return { success: true as const }
    } catch (error: any) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'api_gateway.stop': async () => {
    try {
      await application.get('ApiGatewayService').stop()
      return { success: true as const }
    } catch (error: any) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'api_gateway.restart': async () => {
    try {
      await application.get('ApiGatewayService').restart()
      return { success: true as const }
    } catch (error: any) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}
