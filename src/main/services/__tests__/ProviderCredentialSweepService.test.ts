import '@data/services/ProviderRegistryService'

import { type UserProviderRow, userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ProviderCredentialSweepService } from '@main/services/ProviderCredentialSweepService'
import type { ApiKeyEntry, AuthConfig } from '@shared/data/types/provider'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

// Reversible safeStorage stand-in — the sweep encrypts what it converts.
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

describe('ProviderCredentialSweepService', () => {
  const dbh = setupTestDatabase()
  const service = new ProviderCredentialSweepService()

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

  it('converts plaintext apiKeys and authConfig rows to envelopes in one sweep', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'legacy',
      name: 'Legacy',
      orderKey: 'a0',
      apiKeys: [{ id: 'k1', key: 'sk-legacy', label: 'main', isEnabled: true }],
      authConfig: { type: 'oauth', clientId: 'cid', accessToken: 'at-plain', refreshToken: 'rt-plain' }
    })

    const result = service.sweep()

    expect(result.converted).toBe(1)
    expect(result.skipped).toBe(0)
    // 1 plaintext key + 2 plaintext oauth tokens counted pre-conversion.
    expect(result.envelopes).toEqual({ ss: 0, aes: 0, plain: 3, unknown: 0 })
    const row = await rawRow('legacy')
    expect(row.apiKeys[0].key).toMatch(/^v1:ss:/)
    expect(row.apiKeys[0].key).not.toContain('sk-legacy')
    const storedAuth = expectVariant(row.authConfig, 'oauth')
    expect(storedAuth.accessToken).toMatch(/^v1:ss:/)
    expect(storedAuth.clientId).toBe('cid')

    // Reads through the boundary still restore the plaintext values.
    expect(providerService.getApiKeys('legacy')[0].key).toBe('sk-legacy')
    expect(providerService.getAuthConfig('legacy')).toMatchObject({ accessToken: 'at-plain', refreshToken: 'rt-plain' })
  })

  it('is idempotent: enveloped rows are skipped, their bytes untouched', async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' })
    providerService.addApiKey('openai', 'sk-modern')
    const before = await rawRow('openai')

    const result = service.sweep()

    expect(result.converted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(await rawRow('openai')).toEqual(before)
  })

  it('skips rows with nothing to protect', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'bare',
      name: 'Bare',
      orderKey: 'a0',
      apiKeys: [],
      authConfig: null
    })

    expect(service.sweep().converted).toBe(0)
  })

  it('re-encrypts a restored plaintext backup row while leaving neighbors untouched', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'restored',
      name: 'Restored',
      orderKey: 'a0',
      apiKeys: [{ id: 'k1', key: 'sk-from-backup', isEnabled: true }]
    })
    await dbh.db.insert(userProviderTable).values({ providerId: 'clean', name: 'Clean', orderKey: 'a1' })
    providerService.addApiKey('clean', 'sk-clean')
    const cleanBefore = await rawRow('clean')

    expect(service.sweep().converted).toBe(1)

    expect((await rawRow('restored')).apiKeys[0].key).toMatch(/^v1:ss:/)
    expect(await rawRow('clean')).toEqual(cleanBefore)
  })
})
