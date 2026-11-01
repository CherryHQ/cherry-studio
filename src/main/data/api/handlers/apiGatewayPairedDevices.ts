import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import type { ApiGatewayPairedDeviceSchemas } from '@shared/data/api/schemas/apiGatewayPairedDevices'
import type { HandlersFor } from '@shared/data/api/types'
import { ApiGatewayPairedDeviceRenameSchema } from '@shared/data/types/apiGatewayPairedDevice'

export const apiGatewayPairedDeviceHandlers: HandlersFor<ApiGatewayPairedDeviceSchemas> = {
  '/api-gateway/paired-devices': {
    GET: async () => apiGatewayPairedDeviceService.list()
  },
  '/api-gateway/paired-devices/:id': {
    PATCH: async ({ params, body }) =>
      apiGatewayPairedDeviceService.rename(params.id, ApiGatewayPairedDeviceRenameSchema.parse(body)),
    DELETE: async ({ params }) => {
      apiGatewayPairedDeviceService.delete(params.id)
      return undefined
    }
  }
}
