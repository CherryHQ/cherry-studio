import { randomBytes } from 'node:crypto'

import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { loggerService } from '@logger'
import type { ApiGatewayPairedDevice, ApiGatewayPairedDeviceMetadata } from '@shared/data/types/apiGatewayPairedDevice'

import { isValidToken } from './middleware/auth'
import { createPairedDeviceToken, hashPairedDeviceToken } from './pairedDeviceToken'

const logger = loggerService.withContext('ApiGatewayPairing')

const CODE_TTL_MS = 5 * 60_000
const MAX_FAILED_ATTEMPTS = 10

export type ApiGatewayPairingResult = {
  device: ApiGatewayPairedDevice
  token: string
}

/** Owns the single live QR pairing code for one API Gateway process. */
export class ApiGatewayPairing {
  private code: string | null = null
  private expiresAt = 0
  private failedAttempts = 0

  createCode(): { code: string; expiresAt: number } {
    if (this.code && Date.now() <= this.expiresAt) {
      return { code: this.code, expiresAt: this.expiresAt }
    }

    this.code = randomBytes(16).toString('hex')
    this.expiresAt = Date.now() + CODE_TTL_MS
    this.failedAttempts = 0
    return { code: this.code, expiresAt: this.expiresAt }
  }

  clearCode(): void {
    this.code = null
  }

  consumeCode(candidate: string, device: ApiGatewayPairedDeviceMetadata): ApiGatewayPairingResult | null {
    if (!this.code || Date.now() > this.expiresAt) return null
    if (!isValidToken(candidate, this.code)) {
      this.failedAttempts += 1
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        logger.warn('Pairing code invalidated after too many failed attempts')
        this.code = null
      }
      return null
    }
    this.code = null

    const token = createPairedDeviceToken()
    const pairedDevice = apiGatewayPairedDeviceService.create({
      name: device.name,
      platform: device.platform,
      tokenHash: hashPairedDeviceToken(token)
    })
    return { device: pairedDevice, token }
  }
}
