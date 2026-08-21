import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AuthConfig } from '@shared/data/types/provider'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// The safeStorage mock is a reversible transform (encrypt ∘ decrypt = identity,
// decrypt throws on foreign input) with a random nonce per call — mirroring the
// real cipher's non-determinism — so tests assert round-trip contracts, not
// byte-level snapshots.
const { ssState, ssEncrypt, ssDecrypt } = vi.hoisted(() => ({
  ssState: { available: true },
  ssEncrypt: vi.fn((plain: string) => {
    const nonce = Math.random().toString(36).slice(2)
    return Buffer.from(`mock-ss:${nonce}:${plain}`, 'utf8')
  }),
  ssDecrypt: vi.fn((buffer: Buffer) => {
    const text = buffer.toString('utf8')
    const match = /^mock-ss:[^:]+:(.*)$/s.exec(text)
    if (!match) {
      throw new Error('mock safeStorage: ciphertext was not produced by this key')
    }
    return match[1]
  })
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => ssState.available,
    encryptString: ssEncrypt,
    decryptString: ssDecrypt
  }
}))

// Imported after the electron mock is declared.
const { secretCipher } = await import('../secretCipher')

/** Narrow an authConfig result to one variant so variant fields type-check. */
function expectVariant<T extends AuthConfig['type']>(auth: AuthConfig | null, type: T) {
  if (auth?.type !== type) {
    throw new Error(`expected ${type} authConfig, got ${String(auth?.type ?? auth)}`)
  }
  return auth as Extract<AuthConfig, { type: T }>
}

beforeEach(() => {
  ssState.available = true
  ssEncrypt.mockClear()
  ssDecrypt.mockClear()
})

afterEach(() => {
  vi.resetModules()
})

describe('secretCipher value envelope (safeStorage backend)', () => {
  it('round-trips a secret through a v1:ss: envelope without exposing plaintext', () => {
    const envelope = secretCipher.encryptValue('sk-live-abc123')
    expect(envelope).toMatch(/^v1:ss:/)
    expect(envelope).not.toContain('sk-live-abc123')
    expect(secretCipher.decryptValue(envelope)).toEqual({ value: 'sk-live-abc123', failed: false })
  })

  it('produces a fresh envelope per call (random IV), both decryptable', () => {
    const a = secretCipher.encryptValue('same-secret')
    const b = secretCipher.encryptValue('same-secret')
    expect(a).not.toBe(b)
    expect(secretCipher.decryptValue(a).value).toBe('same-secret')
    expect(secretCipher.decryptValue(b).value).toBe('same-secret')
  })

  it('passes legacy plaintext (no v1: prefix) through unchanged', () => {
    expect(secretCipher.decryptValue('sk-plain-legacy')).toEqual({ value: 'sk-plain-legacy', failed: false })
  })

  it('passes an empty string through unchanged instead of wrapping it', () => {
    expect(secretCipher.encryptValue('')).toBe('')
    expect(secretCipher.decryptValue('')).toEqual({ value: '', failed: false })
  })

  it('fails (does not crash, does not leak the envelope) when safeStorage cannot decrypt', () => {
    const garbage = `v1:ss:${Buffer.from('not-from-this-key').toString('base64')}`
    expect(secretCipher.decryptValue(garbage)).toEqual({ value: '', failed: true })
  })

  it('fails on an unknown envelope method instead of returning the envelope as the key', () => {
    expect(secretCipher.decryptValue('v1:xyz:whatever')).toEqual({ value: '', failed: true })
  })

  it('reports the safe-storage backend when the OS keyring is available', () => {
    expect(secretCipher.getBackend()).toBe('safe-storage')
    expect(secretCipher.getReport()).toMatchObject({ backend: 'safe-storage' })
  })
})

describe('secretCipher fail-closed encryption', () => {
  it('throws when safeStorage.encryptString throws (never falls back to plaintext)', () => {
    ssEncrypt.mockImplementationOnce(() => {
      throw new Error('Keychain access denied')
    })
    expect(() => secretCipher.encryptValue('sk-denied')).toThrow(/Failed to encrypt credential/)
  })

  it('reports unavailable when neither safeStorage nor the key file can be prepared', async () => {
    ssState.available = false
    const fresh = await importFreshCipher({ keyfileRoot: '/nonexistent-root-no-write/z' })
    expect(fresh.getBackend()).toBe('unavailable')
    expect(() => fresh.encryptValue('sk-any')).toThrow(/Failed to prepare local credential key file/)
  })
})

describe('secretCipher API-key entries', () => {
  it('decrypts every entry and preserves id/label/isEnabled', () => {
    const stored = secretCipher.encryptApiKeys([
      { id: 'k1', key: 'sk-one', isEnabled: true, label: 'primary' },
      { id: 'k2', key: 'sk-two', isEnabled: false }
    ])
    expect(secretCipher.decryptApiKeys('openai', stored)).toEqual([
      { id: 'k1', key: 'sk-one', isEnabled: true, label: 'primary' },
      { id: 'k2', key: 'sk-two', isEnabled: false }
    ])
  })

  it('marks an undecryptable entry decryptFailed with an empty key and notifies listeners', () => {
    const failures: unknown[] = []
    const unsubscribe = secretCipher.onDecryptFailure((record) => failures.push(record))
    const stored = secretCipher.encryptApiKeys([{ id: 'k1', key: 'sk-one', isEnabled: true }])
    stored[0].key = `v1:ss:${Buffer.from('foreign').toString('base64')}`

    const decrypted = secretCipher.decryptApiKeys('openai', stored)
    unsubscribe()

    expect(decrypted).toEqual([{ id: 'k1', key: '', isEnabled: true, decryptFailed: true }])
    expect(failures).toEqual([{ providerId: 'openai', kind: 'api-key', label: 'k1' }])
  })

  it('uses the entry label in failure records when present', () => {
    const failures: unknown[] = []
    secretCipher.onDecryptFailure((record) => failures.push(record))
    const decrypted = secretCipher.decryptApiKeys('openai', [
      { id: 'k1', key: 'v1:xyz:future-format', isEnabled: true, label: 'work key' }
    ])
    expect(decrypted[0].decryptFailed).toBe(true)
    expect(failures).toEqual([{ providerId: 'openai', kind: 'api-key', label: 'work key' }])
  })

  it('skips decryptFailed and empty-key entries when re-encrypting (echo round-trip)', () => {
    const echoed = [
      { id: 'k1', key: '', isEnabled: true, decryptFailed: true },
      { id: 'k2', key: '', isEnabled: false }
    ]
    expect(secretCipher.encryptApiKeys(echoed)).toEqual(echoed)
  })
})

describe('secretCipher authConfig field-level envelopes', () => {
  it('wraps only the oauth tokens; clientId stays plaintext at rest', () => {
    const stored = expectVariant(
      secretCipher.encryptAuthConfig({
        type: 'oauth',
        clientId: 'client-id-plain',
        accessToken: 'at-secret',
        refreshToken: 'rt-secret'
      }),
      'oauth'
    )
    expect(stored).toMatchObject({ type: 'oauth', clientId: 'client-id-plain' })
    expect(stored.accessToken).toMatch(/^v1:ss:/)
    expect(stored.refreshToken).toMatch(/^v1:ss:/)

    expect(secretCipher.decryptAuthConfig('github', stored)).toEqual({
      type: 'oauth',
      clientId: 'client-id-plain',
      accessToken: 'at-secret',
      refreshToken: 'rt-secret'
    })
  })

  it('wraps the AWS long-lived credentials and round-trips them', () => {
    const stored = expectVariant(
      secretCipher.encryptAuthConfig({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'AKIA-secret',
        secretAccessKey: 'wJal-secret'
      }),
      'iam-aws'
    )
    expect(stored.region).toBe('us-east-1')
    expect(stored.accessKeyId).toMatch(/^v1:ss:/)
    expect(secretCipher.decryptAuthConfig('bedrock', stored)).toEqual({
      type: 'iam-aws',
      region: 'us-east-1',
      accessKeyId: 'AKIA-secret',
      secretAccessKey: 'wJal-secret'
    })
  })

  it('moves GCP credentials into the shadow envelope at rest and restores the record on read', () => {
    const credentials = { client_email: 'svc@project.iam', private_key: '-----BEGIN KEY-----' }
    const stored = expectVariant(
      secretCipher.encryptAuthConfig({
        type: 'iam-gcp',
        project: 'p',
        location: 'global',
        credentials
      }),
      'iam-gcp'
    )
    expect(stored.credentials).toBeUndefined()
    expect(stored.credentialsEnvelope).toMatch(/^v1:ss:/)

    const restored = expectVariant(secretCipher.decryptAuthConfig('vertex', stored), 'iam-gcp')
    expect(restored.credentialsEnvelope).toBeUndefined()
    expect(restored).toEqual({ type: 'iam-gcp', project: 'p', location: 'global', credentials })
  })

  it('passes non-secret auth variants (api-key) through untouched', () => {
    const auth = { type: 'api-key' as const, headerName: 'Authorization' }
    expect(secretCipher.encryptAuthConfig(auth)).toEqual(auth)
    expect(secretCipher.decryptAuthConfig('ollama', auth)).toEqual(auth)
  })

  it('empties oauth tokens and flags decryptFailed when the stored envelope is undecryptable', () => {
    const failures: unknown[] = []
    secretCipher.onDecryptFailure((record) => failures.push(record))
    const restored = expectVariant(
      secretCipher.decryptAuthConfig('github', {
        type: 'oauth',
        clientId: 'cid',
        accessToken: `v1:ss:${Buffer.from('foreign').toString('base64')}`,
        refreshToken: 'v1:xyz:unknown'
      }),
      'oauth'
    )
    expect(restored).toMatchObject({ decryptFailed: true, accessToken: '', refreshToken: '' })
    expect(failures).toEqual([{ providerId: 'github', kind: 'auth-config', label: 'oauth tokens' }])
  })

  it('flags GCP credentials decryptFailed when the envelope cannot be restored', () => {
    const failures: unknown[] = []
    secretCipher.onDecryptFailure((record) => failures.push(record))
    const restored = expectVariant(
      secretCipher.decryptAuthConfig('vertex', {
        type: 'iam-gcp',
        project: 'p',
        location: 'global',
        credentialsEnvelope: `v1:ss:${Buffer.from('foreign').toString('base64')}`
      }),
      'iam-gcp'
    )
    expect(restored.credentials).toBeUndefined()
    expect(restored.decryptFailed).toBe(true)
    expect(failures).toEqual([{ providerId: 'vertex', kind: 'auth-config', label: 'GCP credentials' }])
  })
})

describe('secretCipher AES key-file fallback (no OS keyring)', () => {
  let dir: string

  beforeEach(() => {
    ssState.available = false
    dir = mkdtempSync(join(tmpdir(), 'secret-cipher-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a 0600 key file in userData and round-trips through a v1:aes: envelope', async () => {
    const cipher = await importFreshCipher({ keyfileRoot: dir })
    const envelope = cipher.encryptValue('sk-linux-user')
    expect(envelope).toMatch(/^v1:aes:/)
    expect(envelope).not.toContain('sk-linux-user')
    expect(cipher.decryptValue(envelope)).toEqual({ value: 'sk-linux-user', failed: false })
    expect(cipher.getBackend()).toBe('aes-keyfile')

    const mode = statSync(join(dir, 'secret.key')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('reuses an existing key file across processes instead of regenerating it', async () => {
    const first = await importFreshCipher({ keyfileRoot: dir })
    const envelope = first.encryptValue('sk-persisted')

    const second = await importFreshCipher({ keyfileRoot: dir })
    expect(second.decryptValue(envelope)).toEqual({ value: 'sk-persisted', failed: false })
  })

  it('throws (fail-closed) when the key file cannot be written', async () => {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'file-where-a-directory-should-be')
    const cipher = await importFreshCipher({ keyfileRoot: blocker })
    expect(() => cipher.encryptValue('sk-any')).toThrow(/Failed to prepare local credential key file/)
  })
})

/**
 * Re-import the cipher singleton with a clean module registry and `getPath`
 * routed at `keyfileRoot`, so key-file tests get isolated keyfile state.
 */
async function importFreshCipher({ keyfileRoot }: { keyfileRoot: string }) {
  vi.resetModules()
  const { application: freshApp } = await import('@application')
  ;(freshApp.getPath as Mock).mockImplementation((_ns: string, filename?: string) => join(keyfileRoot, filename ?? ''))
  return import('../secretCipher').then((m) => m.secretCipher)
}

describe('secretCipher encryptApiKeys hardening', () => {
  it('encrypts a non-empty key even when the input carries a decryptFailed flag', () => {
    // A caller-supplied flag must never act as a "skip encryption" switch.
    const stored = secretCipher.encryptApiKeys([{ id: 'k1', key: 'sk-flagged', isEnabled: true, decryptFailed: true }])
    expect(stored[0].key).toMatch(/^v1:ss:/)
    expect(stored[0].key).not.toContain('sk-flagged')
    expect(stored[0].decryptFailed).toBeUndefined()
  })

  it('passes stored envelopes through unchanged (idempotent re-encrypt)', () => {
    const envelope = secretCipher.encryptValue('sk-real')
    const stored = secretCipher.encryptApiKeys([{ id: 'k1', key: envelope, isEnabled: true }])
    expect(stored[0].key).toBe(envelope)
  })
})

describe('secretCipher AES key-file fallback (malformed file)', () => {
  it('recreates a malformed key file as a fresh 0600 key', async () => {
    ssState.available = false
    const dir = mkdtempSync(join(tmpdir(), 'secret-cipher-test-'))
    try {
      writeFileSync(join(dir, 'secret.key'), Buffer.alloc(8))

      const cipher = await importFreshCipher({ keyfileRoot: dir })
      const envelope = cipher.encryptValue('sk-after-recreate')

      expect(cipher.decryptValue(envelope)).toEqual({ value: 'sk-after-recreate', failed: false })
      expect(statSync(join(dir, 'secret.key')).size).toBe(32)
      expect(statSync(join(dir, 'secret.key')).mode & 0o777).toBe(0o600)
    } finally {
      ssState.available = true
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
