import type { ApiGatewayPairedDevice } from '../../types/apiGatewayPairedDevice'

export type ApiGatewayPairedDeviceSchemas = {
  '/api-gateway/paired-devices': {
    GET: {
      response: ApiGatewayPairedDevice[]
    }
  }
  '/api-gateway/paired-devices/:id': {
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
