import { createHash, randomUUID } from 'node:crypto'

export function createPairedDeviceToken(): string {
  return `cs-dt-${randomUUID()}`
}

export function hashPairedDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
