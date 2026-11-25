import { readFileSync } from 'node:fs'
import path from 'node:path'

import { app, safeStorage } from 'electron'

import { loggerService } from '@logger'
import type { AuthConfig } from '@shared/data/types/provider'

const logger = loggerService.withContext('SecretStorage')

const ENCRYPTED_PREFIX = 'enc:v1:'

export interface SecretCipherBackend {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

let testBackend: SecretCipherBackend | undefined
let windowsKeyPersisted = false

/** Test-only seam; production always uses Electron's OS-backed safeStorage. */
export function setSecretCipherBackendForTests(backend: SecretCipherBackend | undefined): void {
  testBackend = backend
}

function backend(): SecretCipherBackend {
  return testBackend ?? safeStorage
}

export function isSecretStorageAvailable(): boolean {
  try {
    return backend().isEncryptionAvailable()
  } catch {
    return false
  }
}

export function isSecretStorageReadyForWrites(): boolean {
  if (!isSecretStorageAvailable()) return false
  if (testBackend || process.platform !== 'win32' || windowsKeyPersisted) return true
  // Windows safeStorage can encrypt before Chromium writes its profile key to disk.
  try {
    const state = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'Local State'), 'utf8')) as {
      os_crypt?: { encrypted_key?: unknown }
    }
    const key = state.os_crypt?.encrypted_key
    windowsKeyPersisted = typeof key === 'string' && Buffer.from(key, 'base64').subarray(0, 5).toString() === 'DPAPI'
  } catch {
    return false
  }
  return windowsKeyPersisted
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Encrypt one credential value for storage. Plaintext is returned unchanged when
 * the OS keyring is unavailable so the app keeps working on unsupported hosts;
 * callers that require encryption should check `isSecretStorageAvailable()`.
 */
export function encryptSecret(value: string): string {
  if (!value || isEncryptedSecret(value) || !isSecretStorageReadyForWrites()) return value
  try {
    return `${ENCRYPTED_PREFIX}${backend().encryptString(value).toString('base64')}`
  } catch {
    logger.warn('Failed to encrypt a credential; leaving it in its current form')
    return value
  }
}

export class SecretDecryptionError extends Error {
  constructor() {
    super('A stored credential could not be decrypted with the current OS keyring')
    this.name = 'SecretDecryptionError'
  }
}

/** Decrypt a stored credential. Plaintext legacy values pass through unchanged. */
export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value
  if (!isSecretStorageAvailable()) throw new SecretDecryptionError()
  try {
    return backend().decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch {
    throw new SecretDecryptionError()
  }
}

export function tryDecryptSecret(value: string): string | undefined {
  try {
    return decryptSecret(value)
  } catch (error) {
    if (!(error instanceof SecretDecryptionError)) throw error
    logger.warn(error.message)
    return undefined
  }
}

export function encryptApiKeyEntries<T extends { key: string }>(entries: T[]): T[] {
  return entries.map((entry) => ({ ...entry, key: encryptSecret(entry.key) }))
}

export function decryptApiKeyEntries<T extends { key: string }>(entries: T[]): T[] {
  return entries.map((entry) => ({ ...entry, key: decryptSecret(entry.key) }))
}

export function encryptSecretRecord(
  record: Record<string, string> | null | undefined
): Record<string, string> | null | undefined {
  if (!record) return record
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, encryptSecret(value)]))
}

export function decryptSecretRecord(
  record: Record<string, string> | null | undefined
): Record<string, string> | null | undefined {
  if (!record) return record
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, decryptSecret(value)]))
}

export function hasPlaintextSecret(record: Record<string, string> | null | undefined): boolean {
  return !!record && Object.values(record).some((value) => !!value && !isEncryptedSecret(value))
}

function mapJsonStrings(value: unknown, fn: (value: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((entry) => mapJsonStrings(entry, fn))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapJsonStrings(entry, fn)]))
  }
  return value
}

function mapAuthConfig(
  authConfig: AuthConfig | null | undefined,
  map: (value: string) => string
): AuthConfig | null | undefined {
  if (!authConfig) return authConfig
  if (authConfig.type === 'oauth') {
    return {
      ...authConfig,
      ...(authConfig.refreshToken ? { refreshToken: map(authConfig.refreshToken) } : {}),
      ...(authConfig.accessToken ? { accessToken: map(authConfig.accessToken) } : {})
    }
  }
  if (authConfig.type === 'iam-aws') {
    return {
      ...authConfig,
      ...(authConfig.accessKeyId ? { accessKeyId: map(authConfig.accessKeyId) } : {}),
      ...(authConfig.secretAccessKey ? { secretAccessKey: map(authConfig.secretAccessKey) } : {})
    }
  }
  if (authConfig.type === 'iam-gcp' && authConfig.credentials) {
    return {
      ...authConfig,
      credentials: mapJsonStrings(authConfig.credentials, map) as Record<string, unknown>
    }
  }
  return authConfig
}

export function encryptAuthConfig(authConfig: AuthConfig | null | undefined): AuthConfig | null | undefined {
  return mapAuthConfig(authConfig, encryptSecret)
}

export function decryptAuthConfig(authConfig: AuthConfig | null | undefined): AuthConfig | null | undefined {
  return mapAuthConfig(authConfig, decryptSecret)
}
