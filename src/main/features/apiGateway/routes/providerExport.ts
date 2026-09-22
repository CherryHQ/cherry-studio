import { bearer } from '@elysia/bearer'
import { Elysia } from 'elysia'

import { authorizePairedDeviceRequest } from '../middleware/auth'
import { getProviderExportPayload } from '../providerExport'

/** Device-only, read-only provider export. Hidden from the public OpenAPI surface. */
export const providerExportRoutes = new Elysia({ prefix: '/v1/export' })
  .use(bearer())
  .guard({
    as: 'local',
    beforeHandle: ({ bearer: bearerToken, headers, set }) => {
      const token = headers.authorization?.startsWith('Bearer ') ? bearerToken : undefined
      const failure = authorizePairedDeviceRequest(token)
      if (!failure) return undefined
      set.status = failure.status
      return { error: failure.error }
    }
  })
  .get(
    '/providers',
    ({ set }) => {
      set.headers['cache-control'] = 'no-store'
      return getProviderExportPayload()
    },
    { detail: { hide: true } }
  )
