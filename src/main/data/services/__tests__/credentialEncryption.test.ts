import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { mcpServerService } from '@data/services/McpServerService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  type CherryAccountCredentials,
  cherryAccountCredentialStore
} from '@main/services/cherryCloud/CherryAccountCredentialStore'
import { encryptLegacyCredentialsAtRest } from '@main/services/security/credentialAtRest'
import {
  decryptSecret,
  encryptSecret,
  SecretDecryptionError,
  setSecretCipherBackendForTests
} from '@main/services/security/secretStorage'

const PREFIX = 'enc:v1:'
const unreadable = `${PREFIX}AAAA`
const fakeBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText: string) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted: Buffer) => {
    const ciphertext = encrypted.toString('utf8')
    if (!ciphertext.startsWith('sealed:')) throw new Error('Wrong keyring')
    return ciphertext.slice('sealed:'.length)
  }
}
const account: CherryAccountCredentials = {
  version: 1,
  devicePublicKey: 'synthetic-public-key',
  devicePrivateKey: 'synthetic-private-key',
  session: null
}

describe('credential encryption at service boundaries', () => {
  const dbh = setupTestDatabase()
  let accountPath: string

  beforeEach(() => {
    accountPath = join(dirname(dbh.sqlite.name), `${randomUUID()}.json`)
    setSecretCipherBackendForTests(fakeBackend)
    providerRegistryService.clearCache()
    MockMainCacheServiceUtils.resetMocks()
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'app.database.file') return dbh.sqlite.name
      if (key === 'feature.cherry_account.credentials_file') return accountPath
      if (key === 'feature.provider_registry.data' && filename) {
        return resolve('packages/provider-registry/data', filename)
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(() => {
    setSecretCipherBackendForTests(undefined)
  })

  it('encrypts provider API keys and auth config on write and decrypts them for consumers', () => {
    const authConfig = {
      type: 'oauth' as const,
      clientId: 'client',
      refreshToken: 'refresh-value',
      accessToken: 'access-value'
    }
    providerService.create({
      providerId: 'p',
      name: 'Provider',
      apiKeys: [{ id: 'key-a', key: 'sk-plaintext', isEnabled: true }],
      authConfig
    })

    const [row] = dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p')).all()
    expect(row.apiKeys?.[0].key.startsWith(PREFIX)).toBe(true)
    expect(row.authConfig?.type).toBe('oauth')
    if (row.authConfig?.type !== 'oauth') throw new Error('expected oauth auth config')
    expect(row.authConfig.refreshToken?.startsWith(PREFIX)).toBe(true)
    expect(row.authConfig.accessToken?.startsWith(PREFIX)).toBe(true)

    expect(providerService.getApiKeys('p')).toEqual([{ id: 'key-a', key: 'sk-plaintext', isEnabled: true }])
    expect(providerService.getAuthConfig('p')).toEqual(authConfig)
    expect(decryptSecret(row.apiKeys?.[0].key ?? '')).toBe('sk-plaintext')
  })

  it('seals credentials left in plaintext by older builds and is idempotent', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'legacy-provider',
        name: 'Legacy',
        orderKey: generateOrderKeyBetween(null, null),
        apiKeys: [{ id: 'legacy-key', key: 'legacy-plaintext', isEnabled: true }],
        authConfig: { type: 'oauth', clientId: 'client', refreshToken: 'legacy-refresh' }
      })
      .run()
    dbh.db
      .insert(mcpServerTable)
      .values({
        id: 'legacy-mcp',
        name: 'legacy-mcp',
        type: 'stdio',
        command: 'node',
        env: { API_KEY: 'legacy-env' },
        headers: { Authorization: 'Bearer legacy' }
      })
      .run()

    encryptLegacyCredentialsAtRest()
    encryptLegacyCredentialsAtRest()

    const provider = dbh.db.select().from(userProviderTable).get()
    const mcp = dbh.db.select().from(mcpServerTable).get()
    expect(provider?.apiKeys?.[0].key.startsWith(PREFIX)).toBe(true)
    if (provider?.authConfig?.type !== 'oauth') throw new Error('expected oauth auth config')
    expect(provider.authConfig.refreshToken?.startsWith(PREFIX)).toBe(true)
    expect(mcp?.env?.API_KEY.startsWith(PREFIX)).toBe(true)
    expect(mcp?.headers?.Authorization.startsWith(PREFIX)).toBe(true)
    expect(providerService.getApiKeys('legacy-provider')[0].key).toBe('legacy-plaintext')
    expect(mcpServerService.getById('legacy-mcp').env).toEqual({ API_KEY: 'legacy-env' })
  })

  it('encrypts MCP env/headers on write and decrypts them on read', () => {
    const created = mcpServerService.create({
      name: 'mcp',
      type: 'stdio',
      command: 'node',
      env: { API_KEY: 'secret-value' },
      headers: { Authorization: 'Bearer secret-token' }
    })

    expect(created.env).toEqual({ API_KEY: 'secret-value' })
    expect(created.headers).toEqual({ Authorization: 'Bearer secret-token' })

    const [row] = dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.id, created.id)).all()
    expect(row.env?.API_KEY.startsWith(PREFIX)).toBe(true)
    expect(row.headers?.Authorization.startsWith(PREFIX)).toBe(true)
    expect(mcpServerService.getById(created.id).env).toEqual({ API_KEY: 'secret-value' })
  })

  it('keeps a locked key through unrelated edits and replaces only visible entries', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'p',
        name: 'Provider',
        orderKey: generateOrderKeyBetween(null, null),
        apiKeys: [{ id: 'locked', key: unreadable, isEnabled: true }]
      })
      .run()

    providerService.addApiKey('p', 'new-key')
    const visibleKeys = providerService.getApiKeys('p')
    expect(visibleKeys.map(({ key }) => key)).toEqual(['new-key'])
    providerService.replaceApiKeys('p', visibleKeys)

    const after = dbh.db.select().from(userProviderTable).get()?.apiKeys
    expect(after?.map(({ id }) => id).sort()).toEqual(['locked', visibleKeys[0].id].sort())
    expect(after?.find(({ id }) => id === 'locked')).toEqual({ id: 'locked', key: unreadable, isEnabled: true })
  })

  it('fails closed when every enabled provider credential cannot be decrypted', () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'p',
        name: 'Provider',
        orderKey: generateOrderKeyBetween(null, null),
        apiKeys: [{ id: 'only', key: encryptSecret('provider-key'), isEnabled: true }]
      })
      .run()
    setSecretCipherBackendForTests({
      ...fakeBackend,
      decryptString: () => {
        throw new Error('Wrong keyring')
      }
    })

    expect(() => providerService.getApiKeys('p', { enabled: true })).toThrow(SecretDecryptionError)
    expect(() => providerService.resolveApiKey('p')).toThrow(SecretDecryptionError)
    expect(() => providerService.getRotatedApiKey('p')).toThrow(SecretDecryptionError)
  })

  it('fails closed when MCP credentials cannot be decrypted', () => {
    dbh.db
      .insert(mcpServerTable)
      .values({
        id: 'locked-mcp',
        name: 'mcp',
        type: 'stdio',
        command: 'node',
        env: { API_KEY: unreadable, REGION: 'local' },
        headers: { Authorization: unreadable }
      })
      .run()

    expect(() => mcpServerService.getById('locked-mcp')).toThrow(SecretDecryptionError)
    expect(() => mcpServerService.list({})).toThrow(SecretDecryptionError)
  })

  it('seals a legacy account file and keeps the original when the keyring is unavailable', () => {
    writeFileSync(accountPath, JSON.stringify(account))
    expect(cherryAccountCredentialStore.get()).toEqual(account)
    const ciphertext = readFileSync(accountPath, 'utf8')
    expect(ciphertext.startsWith(PREFIX)).toBe(true)

    setSecretCipherBackendForTests({ ...fakeBackend, isEncryptionAvailable: () => false })
    expect(cherryAccountCredentialStore.get()).toBeNull()
    expect(() => cherryAccountCredentialStore.replace(account)).toThrow(SecretDecryptionError)
    expect(readFileSync(accountPath, 'utf8')).toBe(ciphertext)
  })
})
