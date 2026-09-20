import { hostname } from 'node:os'

import { app } from 'electron'
import { Elysia } from 'elysia'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { ApiGatewayPairedDeviceMetadataSchema } from '@shared/data/types/apiGatewayPairedDevice'

const logger = loggerService.withContext('PairingRoutes')
const MAX_PAIRING_BODY_BYTES = 4 * 1024

const PairBodySchema = z.object({
  code: z
    .string()
    .length(32)
    .regex(/^[0-9a-f]{32}$/, 'Pairing code must be 32 lowercase hexadecimal characters'),
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
  {
    body: PairBodySchema,
    detail: { hide: true },
    parse: async ({ request, contentType, set, status }) => {
      const reader = request.body?.getReader()
      if (!reader) return undefined

      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_PAIRING_BODY_BYTES) {
            // Close after sending 413; cancelling the stream here destroys the response socket too.
            set.headers.connection = 'close'
            throw status(413, {
              error: { code: 'PAYLOAD_TOO_LARGE', message: 'Pairing request body exceeds 4 KiB' }
            })
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }

      const body = Buffer.concat(chunks, size).toString('utf8')
      return contentType === 'application/json' ? JSON.parse(body) : body
    }
  }
)
