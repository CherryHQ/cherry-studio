import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { application } from '@application'
import { safeStorage } from 'electron'

const CONNECTION_FILE_VERSION = 1

export interface StellaConnectionInfo {
  endpoint: string
  configured: true
}

interface StoredConnection {
  version: number
  endpoint: string
  encryptedPat: string
}

/**
 * The POC deliberately owns one global Stella account. Split this into a connection-id keyed
 * store when Cherry needs multiple accounts; agent rows already carry only remote identity.
 */
export class StellaConnectionService {
  configure(endpoint: string, pat: string): StellaConnectionInfo {
    assertSecureStorage('saved')
    const normalizedEndpoint = normalizeStellaEndpoint(endpoint)
    if (!pat.trim()) throw new Error('A Stella personal access token is required')

    const encryptedPat = safeStorage.encryptString(pat).toString('base64')
    const stored: StoredConnection = { version: CONNECTION_FILE_VERSION, endpoint: normalizedEndpoint, encryptedPat }
    const file = application.getPath('feature.agents.stella.connection_file')
    writeFileSync(file, JSON.stringify(stored), { mode: 0o600 })
    chmodSync(file, 0o600)
    return { endpoint: normalizedEndpoint, configured: true }
  }

  getInfo(): StellaConnectionInfo | null {
    const stored = this.readStoredConnection()
    return stored ? { endpoint: stored.endpoint, configured: true } : null
  }

  getCredentials(): { endpoint: string; pat: string } {
    assertSecureStorage('read')
    const stored = this.readStoredConnection()
    if (!stored) throw new Error('Configure a Stella connection before using Stella agents')
    try {
      return { endpoint: stored.endpoint, pat: safeStorage.decryptString(Buffer.from(stored.encryptedPat, 'base64')) }
    } catch {
      throw new Error('The saved Stella credential cannot be decrypted; configure the connection again')
    }
  }

  private readStoredConnection(): StoredConnection | null {
    const file = application.getPath('feature.agents.stella.connection_file')
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredConnection>
      if (parsed.version !== CONNECTION_FILE_VERSION || typeof parsed.encryptedPat !== 'string') {
        throw new Error('invalid connection file')
      }
      return {
        version: parsed.version,
        endpoint: normalizeStellaEndpoint(String(parsed.endpoint)),
        encryptedPat: parsed.encryptedPat
      }
    } catch {
      throw new Error('The saved Stella connection is invalid; configure it again')
    }
  }
}

function assertSecureStorage(operation: 'saved' | 'read'): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`Secure storage is unavailable; Stella credentials cannot be ${operation} on this device`)
  }
  if (process.platform !== 'linux') return

  let backend: ReturnType<typeof safeStorage.getSelectedStorageBackend>
  try {
    backend = safeStorage.getSelectedStorageBackend()
  } catch {
    throw new Error(`Secure storage is unavailable; Stella credentials cannot be ${operation} on this device`)
  }
  // Electron falls back to reversible plaintext on Linux when no secret store is available.
  if (backend === 'basic_text') {
    throw new Error(`Secure storage is unavailable; Stella credentials cannot be ${operation} on this device`)
  }
}

export function normalizeStellaEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Stella endpoint must be a valid HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Stella endpoint must use HTTP or HTTPS')
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('Stella endpoint must use HTTPS unless it is a loopback address')
  }
  if (url.username || url.password) {
    throw new Error('Stella endpoint must not contain credentials')
  }
  url.hash = ''
  url.search = ''
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Stella endpoint must not include a path')
  }
  return url.toString().replace(/\/$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export const stellaConnectionService = new StellaConnectionService()
