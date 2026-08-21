// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { type UserProviderRow, userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { secretCipher } from '@main/core/security/secretCipher'
import type { ApiKeyEntry, AuthConfig } from '@shared/data/types/provider'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Reversible safeStorage stand-in so at-rest ciphertext assertions can verify
// real envelopes (v1:ss:) and reads can be cross-checked against plaintext.
const { ssEncrypt, ssDecrypt } = vi.hoisted(() => ({
  ssEncrypt: vi.fn((plain: string) => {
    const nonce = Math.random().toString(36).slice(2)
    return Buffer.from(`mock-ss:${nonce}:${plain}`, 'utf8')
  }),
  ssDecrypt: vi.fn((buffer: Buffer) => {
    const match = /^mock-ss:[^:]+:(.*)$/s.exec(buffer.toString('utf8'))
    if (!match) throw new Error('mock safeStorage: ciphertext was not produced by this key')
    return match[1]
  })
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: ssEncrypt,
    decryptString: ssDecrypt
  }
}))

describe('ProviderService credential read/write boundary (S7)', () => {
  const dbh = setupTestDatabase()

  /** Narrow a stored authConfig to one variant so variant fields type-check. */
  function expectVariant<T extends AuthConfig['type']>(auth: AuthConfig | null, type: T) {
    if (auth?.type !== type) {
      throw new Error(`expected ${type} authConfig, got ${String(auth?.type ?? auth)}`)
    }
    return auth as Extract<AuthConfig, { type: T }>
  }

  async function rawRow(providerId: string): Promise<UserProviderRow & { apiKeys: ApiKeyEntry[] }> {
    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))
    if (!row || row.apiKeys === null) {
      throw new Error(`expected seeded row (with apiKeys array) for ${providerId}`)
    }
    return { ...row, apiKeys: row.apiKeys }
  }

  async function seedProvider(providerId: string) {
    await dbh.db.insert(userProviderTable).values({ providerId, name: providerId, orderKey: 'a0' })
  }

  it('stores API keys as envelopes while reads return plaintext', async () => {
    await seedProvider('openai')

    providerService.addApiKey('openai', 'sk-plain-1', 'primary')

    const row = await rawRow('openai')
    expect(row.apiKeys).toHaveLength(1)
    expect(row.apiKeys[0].key).toMatch(/^v1:ss:/)
    expect(row.apiKeys[0].key).not.toContain('sk-plain-1')
    expect(row.apiKeys[0]).toMatchObject({ label: 'primary', isEnabled: true })

    expect(providerService.getApiKeys('openai')).toEqual([
      { id: row.apiKeys[0].id, key: 'sk-plain-1', label: 'primary', isEnabled: true }
    ])
  })

  it('dedupes a re-added key against the decrypted stored value', async () => {
    await seedProvider('openai')

    providerService.addApiKey('openai', 'sk-a')
    providerService.addApiKey('openai', 'sk-a')

    const row = await rawRow('openai')
    expect(row.apiKeys).toHaveLength(1)
  })

  it('resolves API keys to plaintext for the wire (override match included)', async () => {
    await seedProvider('openai')
    providerService.addApiKey('openai', 'sk-a')
    providerService.addApiKey('openai', 'sk-b')

    const resolved = providerService.resolveApiKey('openai', 'sk-b')
    expect(resolved.value).toBe('sk-b')
    expect(resolved.apiKeySelection).toMatchObject({ attribution: 'matched', id: expect.any(String) })
  })

  it('rewrites a key update as a fresh envelope with the plaintext gone', async () => {
    await seedProvider('openai')
    providerService.addApiKey('openai', 'sk-old')
    const rowBefore = await rawRow('openai')

    providerService.updateApiKey('openai', rowBefore.apiKeys[0].id, { key: 'sk-new' })

    const row = await rawRow('openai')
    expect(row.apiKeys[0].key).toMatch(/^v1:ss:/)
    expect(row.apiKeys[0].key).not.toContain('sk-new')
    expect(row.apiKeys[0].key).not.toBe(rowBefore.apiKeys[0].key)
    expect(providerService.getApiKeys('openai')[0].key).toBe('sk-new')
  })

  it('strips the decryptFailed marker when replacing with echoed entries', async () => {
    await seedProvider('openai')

    providerService.replaceApiKeys('openai', [
      { id: 'k-live', key: 'sk-live', isEnabled: true },
      { id: 'k-failed', key: '', decryptFailed: true, isEnabled: true }
    ])

    const row = await rawRow('openai')
    expect(row.apiKeys.find((entry) => entry.id === 'k-live')?.key).toMatch(/^v1:ss:/)
    const failed = row.apiKeys.find((entry) => entry.id === 'k-failed')
    expect(failed).toMatchObject({ key: '', isEnabled: true })
    expect(failed?.decryptFailed).toBeUndefined()
  })

  it('clears decryptFailed when an updated key value re-secures the entry', async () => {
    await seedProvider('openai')
    await dbh.db.insert(userProviderTable).values({
      providerId: 'echo',
      name: 'echo',
      orderKey: 'a1',
      apiKeys: [{ id: 'k1', key: '', decryptFailed: true, isEnabled: true }]
    })

    providerService.updateApiKey('echo', 'k1', { key: 'sk-reentered' })

    const decrypted = secretCipher.decryptApiKeys('echo', (await rawRow('echo')).apiKeys)
    expect(decrypted[0]).toMatchObject({ key: 'sk-reentered', isEnabled: true })
    expect(decrypted[0].decryptFailed).toBeUndefined()
  })

  it('wraps authConfig tokens on update and restores them on read', async () => {
    await seedProvider('oauth-demo')

    providerService.update('oauth-demo', {
      authConfig: { type: 'oauth', clientId: 'client-plain', accessToken: 'at-secret', refreshToken: 'rt-secret' }
    })

    const row = await rawRow('oauth-demo')
    expect(row.authConfig).toMatchObject({ type: 'oauth', clientId: 'client-plain' })
    const storedAuth = expectVariant(row.authConfig, 'oauth')
    expect(storedAuth.accessToken).toMatch(/^v1:ss:/)
    expect(storedAuth.refreshToken).not.toContain('rt-secret')

    expect(providerService.getAuthConfig('oauth-demo')).toEqual({
      type: 'oauth',
      clientId: 'client-plain',
      accessToken: 'at-secret',
      refreshToken: 'rt-secret'
    })
  })

  it('moves GCP credentials into the shadow envelope on create and restores them on read', async () => {
    const credentials = { client_email: 'svc@p.iam', private_key: '-----BEGIN KEY-----' }
    providerService.create({
      providerId: 'vertex',
      name: 'Vertex',
      authConfig: { type: 'iam-gcp', project: 'p', location: 'global', credentials }
    })

    const row = await rawRow('vertex')
    const storedAuth = expectVariant(row.authConfig, 'iam-gcp')
    expect(storedAuth.credentials).toBeUndefined()
    expect(storedAuth.credentialsEnvelope).toMatch(/^v1:ss:/)

    expect(providerService.getAuthConfig('vertex')).toEqual({
      type: 'iam-gcp',
      project: 'p',
      location: 'global',
      credentials
    })
  })

  it('encrypts apiKeys on the create path too', async () => {
    providerService.create({
      providerId: 'fresh',
      name: 'Fresh',
      apiKeys: [{ id: 'k1', key: 'sk-create', isEnabled: true }]
    })

    const row = await rawRow('fresh')
    expect(row.apiKeys[0].key).toMatch(/^v1:ss:/)
    expect(providerService.getApiKeys('fresh')[0].key).toBe('sk-create')
  })

  it('marks an undecryptable stored envelope decryptFailed on read', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'broken',
      name: 'broken',
      orderKey: 'a0',
      apiKeys: [
        { id: 'k1', key: `v1:ss:${Buffer.from('foreign-key').toString('base64')}`, isEnabled: true, label: 'work' }
      ]
    })

    expect(providerService.getApiKeys('broken')).toEqual([
      { id: 'k1', key: '', isEnabled: true, label: 'work', decryptFailed: true }
    ])
  })

  it('fails closed on an encrypt error: the write aborts and nothing lands in the row', async () => {
    await seedProvider('openai')
    providerService.addApiKey('openai', 'sk-first')
    const before = (await rawRow('openai')).apiKeys

    ssEncrypt.mockImplementationOnce(() => {
      throw new Error('Keychain access denied')
    })
    expect(() => providerService.addApiKey('openai', 'sk-second')).toThrow(/Failed to encrypt credential/)

    const row = await rawRow('openai')
    expect(row.apiKeys).toEqual(before)
    expect(JSON.stringify(row.apiKeys)).not.toContain('sk-second')
  })
})
