import { hostname } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { ApiGatewayPairedDeviceMetadataSchema } from '@shared/data/types/apiGatewayPairedDevice'
import { app } from 'electron'
import { Elysia } from 'elysia'
import * as z from 'zod'

const logger = loggerService.withContext('PairingRoutes')

const PairBodySchema = z.object({
  code: z.string().min(1, 'Pairing code is required'),
  device: z.object(ApiGatewayPairedDeviceMetadataSchema.shape)
})

/**
 * `POST /pair` — one-time LAN pairing bootstrap for the mobile client. Public on
 * purpose: the caller has no credentials yet, and possession of the live QR
 * pairing code (single-use, short TTL, issued only while the settings page shows
 * the QR) is the proof of proximity. Hidden from the OpenAPI docs — it is a
 * Cherry-client bootstrap contract, not part of the public API surface.
 */
export const pairingRoutes = new Elysia().post(
  '/pair',
  ({ body, set }) => {
    const device = application.get('ApiGatewayService').pairDevice(body.code, body.device)
    if (!device) {
      set.status = 403
      return { error: 'Invalid or expired pairing code' }
    }
    logger.info('Paired new LAN device', { name: device.device.name, platform: device.device.platform })
    return {
      token: device.token,
      name: hostname(),
      version: app.getVersion()
    }
  },
  { body: PairBodySchema, detail: { hide: true } }
)
