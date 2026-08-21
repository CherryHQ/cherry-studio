import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import type { ApiKeyEntry, AuthConfig } from '@shared/data/types/provider'
import { safeStorage } from 'electron'

const logger = loggerService.withContext('SecretCipher')

/**
 * At-rest encryption for provider credentials (security review S7).
 *
 * Envelope formats (the prefix itself is the plaintext/ciphertext marker — no
 * extra schema column is needed; a value without the prefix is legacy plaintext
 * and passes through unchanged):
 *
 *   v1:ss:<base64(safeStorage buffer)>          OS keychain / DPAPI / libsecret
 *   v1:aes:<base64(iv(12) || tag(16) || ct)>    Linux fallback key file (0600)
 *
 * Both APIs are synchronous on purpose: the credential read/write boundary
 * lives inside better-sqlite3 transactions (sync by contract), and each value
 * is sub-kilobyte, so the sync cost is sub-millisecond (same tradeoff as
 * CopilotService's safeStorage usage).
 *
 * Error model: encrypt failures THROW (fail-closed — a credential must never
 * silently fall back to plaintext at rest); decrypt failures return a marker
 * so the UI can guide re-entry instead of crashing the read path.
 */

const ENVELOPE_PREFIX = 'v1:'
const METHOD_SAFE_STORAGE = 'ss'
const METHOD_AES = 'aes'
const AES_KEY_BYTES = 32
const AES_IV_BYTES = 12
const AES_TAG_BYTES = 16
const KEYFILE_NAME = 'secret.key'

export type SecretBackend = 'safe-storage' | 'aes-keyfile' | 'unavailable'

/** Whether a stored value is an encrypted envelope (vs legacy plaintext). */
export function isEnvelopeValue(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX)
}

/**
 * Classify a stored credential value by envelope method (boot diagnostics).
 * Unknown `v1:*:` values and corrupt non-strings read as what they effectively
 * are on this version — not a decryptable envelope.
 */
export function envelopeMethodOf(value: string | undefined | null): 'ss' | 'aes' | 'unknown' | 'plain' {
  if (!value || typeof value !== 'string') return 'plain'
  if (value.startsWith(`${ENVELOPE_PREFIX}${METHOD_SAFE_STORAGE}:`)) return 'ss'
  if (value.startsWith(`${ENVELOPE_PREFIX}${METHOD_AES}:`)) return 'aes'
  return isEnvelopeValue(value) ? 'unknown' : 'plain'
}

/** Whether a stored value is an envelope THIS version can decrypt. */
function isKnownEnvelope(value: string): boolean {
  const method = envelopeMethodOf(value)
  return method === 'ss' || method === 'aes'
}

export interface DecryptResult {
  value: string
  failed: boolean
}

/** One credential entry that could not be decrypted (drives the re-entry UI). */
export interface DecryptFailureRecord {
  providerId: string
  kind: 'api-key' | 'auth-config'
  /** Key label (falls back to the entry id) or the auth-config field name. */
  label: string
}

export interface SecretCipherReport {
  platform: string
  backend: SecretBackend
}

type DecryptFailureListener = (record: DecryptFailureRecord) => void

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class SecretCipher {
  private aesKey: Buffer | null = null
  private readonly listeners = new Set<DecryptFailureListener>()

  /** Non-lifecycle singleton: no boot side effects, no long-lived resources. */
  getBackend(): SecretBackend {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return 'safe-storage'
      }
    } catch (error) {
      logger.warn('safeStorage availability check failed', { error: errorMessage(error) })
    }
    return this.tryLoadAesKey() !== null ? 'aes-keyfile' : 'unavailable'
  }

  getReport(): SecretCipherReport {
    return { platform: platform(), backend: this.getBackend() }
  }

  onDecryptFailure(listener: DecryptFailureListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyDecryptFailure(record: DecryptFailureRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(record)
      } catch (error) {
        logger.warn('Decrypt-failure listener threw', { error: errorMessage(error) })
      }
    }
  }

  encryptValue(plain: string): string {
    if (!plain) return plain
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return ENVELOPE_PREFIX + METHOD_SAFE_STORAGE + ':' + safeStorage.encryptString(plain).toString('base64')
      }
    } catch (error) {
      throw new Error(`Failed to encrypt credential via OS secure storage: ${errorMessage(error)}`)
    }
    const key = this.requireAesKey()
    const iv = randomBytes(AES_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ENVELOPE_PREFIX + METHOD_AES + ':' + Buffer.concat([iv, tag, ciphertext]).toString('base64')
  }

  decryptValue(envelope: string): DecryptResult {
    if (!envelope.startsWith(ENVELOPE_PREFIX)) {
      return { value: envelope, failed: false }
    }
    const rest = envelope.slice(ENVELOPE_PREFIX.length)
    if (rest.startsWith(`${METHOD_SAFE_STORAGE}:`)) {
      try {
        const buffer = Buffer.from(rest.slice(METHOD_SAFE_STORAGE.length + 1), 'base64')
        return { value: safeStorage.decryptString(buffer), failed: false }
      } catch (error) {
        logger.warn('safeStorage decrypt failed', { error: errorMessage(error) })
        return { value: '', failed: true }
      }
    }
    if (rest.startsWith(`${METHOD_AES}:`)) {
      try {
        const raw = Buffer.from(rest.slice(METHOD_AES.length + 1), 'base64')
        const key = this.tryLoadAesKey()
        if (!key || raw.length <= AES_IV_BYTES + AES_TAG_BYTES) {
          return { value: '', failed: true }
        }
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, AES_IV_BYTES))
        decipher.setAuthTag(raw.subarray(AES_IV_BYTES, AES_IV_BYTES + AES_TAG_BYTES))
        const plain = Buffer.concat([
          decipher.update(raw.subarray(AES_IV_BYTES + AES_TAG_BYTES)),
          decipher.final()
        ]).toString('utf8')
        return { value: plain, failed: false }
      } catch (error) {
        logger.warn('AES key-file decrypt failed', { error: errorMessage(error) })
        return { value: '', failed: true }
      }
    }
    // Unknown envelope method: fail rather than hand the envelope string to
    // the network as if it were the credential (future-format safety).
    logger.warn('Unknown credential envelope method', { method: rest.split(':', 1)[0] })
    return { value: '', failed: true }
  }

  encryptApiKeys(entries: ApiKeyEntry[]): ApiKeyEntry[] {
    return entries.map((entry) => {
      // Skip only empty values and envelopes this version can still decrypt;
      // a caller-supplied decryptFailed flag must never disable encryption.
      // Plaintext that merely starts with `v1:` still gets wrapped.
      if (!entry.key || isKnownEnvelope(entry.key)) return entry
      return { ...entry, key: this.encryptValue(entry.key), decryptFailed: undefined }
    })
  }

  /** Whether any stored key value is still legacy plaintext (sweep detection). */
  needsEncryptionApiKeys(entries: ApiKeyEntry[]): boolean {
    return entries.some((entry) => !!entry.key && !isKnownEnvelope(entry.key))
  }

  /** Whether any secret field of `auth` is still legacy plaintext (sweep detection). */
  needsEncryptionAuthConfig(auth: AuthConfig | null | undefined): boolean {
    if (!auth) return false
    switch (auth.type) {
      case 'oauth':
        return [auth.accessToken, auth.refreshToken].some((value) => !!value && !isKnownEnvelope(value))
      case 'iam-aws':
        return [auth.accessKeyId, auth.secretAccessKey].some((value) => !!value && !isKnownEnvelope(value))
      case 'iam-gcp':
        return auth.credentials !== undefined
      default:
        return false
    }
  }

  decryptApiKeys(providerId: string, entries: ApiKeyEntry[]): ApiKeyEntry[] {
    return entries.map((entry) => {
      if (typeof entry.key !== 'string') {
        this.notifyDecryptFailure({ providerId, kind: 'api-key', label: entry.label ?? entry.id })
        return { ...entry, key: '', decryptFailed: true }
      }
      const result = this.decryptValue(entry.key)
      if (!result.failed) {
        return { ...entry, key: result.value, decryptFailed: undefined }
      }
      this.notifyDecryptFailure({ providerId, kind: 'api-key', label: entry.label ?? entry.id })
      return { ...entry, key: '', decryptFailed: true }
    })
  }

  encryptAuthConfig(auth: AuthConfig | null | undefined): AuthConfig | null {
    if (!auth) return auth ?? null
    switch (auth.type) {
      case 'oauth':
        return {
          ...auth,
          decryptFailed: undefined,
          accessToken: this.encryptValue(auth.accessToken ?? ''),
          refreshToken: this.encryptValue(auth.refreshToken ?? '')
        }
      case 'iam-aws':
        return {
          ...auth,
          decryptFailed: undefined,
          accessKeyId: this.encryptValue(auth.accessKeyId ?? ''),
          secretAccessKey: this.encryptValue(auth.secretAccessKey ?? '')
        }
      case 'iam-gcp': {
        const { credentials, ...rest } = auth
        return {
          ...rest,
          decryptFailed: undefined,
          // GCP credentials are a JSON record; the envelope lives in a shadow
          // string field so the record shape stays schema-valid.
          credentialsEnvelope: credentials ? this.encryptValue(JSON.stringify(credentials)) : undefined
        }
      }
      default:
        // api-key / api-key-aws / iam-azure carry no secrets — nothing to wrap.
        return auth
    }
  }

  decryptAuthConfig(providerId: string, auth: AuthConfig | null | undefined): AuthConfig | null {
    if (!auth) return auth ?? null
    switch (auth.type) {
      case 'oauth': {
        const accessToken = this.decryptValue(auth.accessToken ?? '')
        const refreshToken = this.decryptValue(auth.refreshToken ?? '')
        if (!accessToken.failed && !refreshToken.failed) {
          return { ...auth, accessToken: accessToken.value, refreshToken: refreshToken.value }
        }
        this.notifyDecryptFailure({ providerId, kind: 'auth-config', label: 'oauth tokens' })
        return { ...auth, accessToken: '', refreshToken: '', decryptFailed: true }
      }
      case 'iam-aws': {
        const accessKeyId = this.decryptValue(auth.accessKeyId ?? '')
        const secretAccessKey = this.decryptValue(auth.secretAccessKey ?? '')
        if (!accessKeyId.failed && !secretAccessKey.failed) {
          return { ...auth, accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value }
        }
        this.notifyDecryptFailure({ providerId, kind: 'auth-config', label: 'AWS credentials' })
        return { ...auth, accessKeyId: '', secretAccessKey: '', decryptFailed: true }
      }
      case 'iam-gcp': {
        if (!auth.credentialsEnvelope) {
          return auth
        }
        const envelope = this.decryptValue(auth.credentialsEnvelope)
        if (!envelope.failed) {
          try {
            // oxlint-disable-next-line no-unused-vars
            const { credentialsEnvelope: _dropped, ...rest } = auth
            return { ...rest, credentials: JSON.parse(envelope.value) as Record<string, unknown> }
          } catch (error) {
            logger.warn('GCP credentials envelope did not parse as JSON', {
              providerId,
              error: errorMessage(error)
            })
          }
        }
        this.notifyDecryptFailure({ providerId, kind: 'auth-config', label: 'GCP credentials' })
        // oxlint-disable-next-line no-unused-vars
        const { credentialsEnvelope: _dropped, ...rest } = auth
        return { ...rest, decryptFailed: true }
      }
      default:
        return auth
    }
  }

  private tryLoadAesKey(): Buffer | null {
    if (this.aesKey) return this.aesKey
    try {
      const keyfilePath = application.getPath('app.userdata', KEYFILE_NAME)
      if (existsSync(keyfilePath)) {
        const existing = readFileSync(keyfilePath)
        if (existing.length === AES_KEY_BYTES) {
          this.aesKey = existing
          return existing
        }
        logger.warn('Malformed credential key file; recreating', { size: existing.length })
      }
      // Sync IO is deliberate: called at most once per process from within
      // (sync) credential write paths, and the payload is 32 bytes.
      const created = randomBytes(AES_KEY_BYTES)
      writeFileSync(keyfilePath, created, { mode: 0o600 })
      // writeFileSync mode only applies to newly created files; re-apply in
      // case a pre-existing malformed file had drifted to looser permissions.
      chmodSync(keyfilePath, 0o600)
      this.aesKey = created
      return created
    } catch (error) {
      logger.error('Failed to prepare AES credential key file', { error: errorMessage(error) })
      return null
    }
  }

  private requireAesKey(): Buffer {
    const key = this.tryLoadAesKey()
    if (!key) {
      throw new Error('Failed to prepare local credential key file')
    }
    return key
  }
}

export const secretCipher = new SecretCipher()
