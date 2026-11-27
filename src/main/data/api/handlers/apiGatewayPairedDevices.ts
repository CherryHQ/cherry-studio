import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import type { ApiGatewayPairedDeviceSchemas } from '@shared/data/api/schemas/apiGatewayPairedDevices'
import type { HandlersFor } from '@shared/data/api/types'

export const apiGatewayPairedDeviceHandlers: HandlersFor<ApiGatewayPairedDeviceSchemas> = {
  '/api-gateway/paired-devices': {
    GET: async () => apiGatewayPairedDeviceService.list()
  },
  '/api-gateway/paired-devices/:id': {
    DELETE: async ({ params }) => {
      apiGatewayPairedDeviceService.delete(params.id)
      return undefined
    }
  }
}
