import type { ApiGatewayPairedDevice, ApiGatewayPairedDeviceRename } from '../../types/apiGatewayPairedDevice'

export type ApiGatewayPairedDeviceSchemas = {
  '/api-gateway/paired-devices': {
    GET: {
      response: ApiGatewayPairedDevice[]
    }
  }
  '/api-gateway/paired-devices/:id': {
    PATCH: {
      params: { id: string }
      body: ApiGatewayPairedDeviceRename
      response: ApiGatewayPairedDevice
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
