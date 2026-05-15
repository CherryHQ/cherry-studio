import { resolve } from 'node:path'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { AddProviderApiKeySchema, ReplaceProviderApiKeysSchema } from '@shared/data/api/schemas/providers'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ProviderService API keys', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    providerRegistryService.clearCache()
    MockMainCacheServiceUtils.resetMocks()
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.provider_registry.data' && filename) {
        return resolve('packages/provider-registry/data', filename)
      }

      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  async function seedProvider() {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: [
        { id: 'key-a', key: 'sk-a', label: 'A', isEnabled: true },
        { id: 'key-b', key: 'sk-b', label: 'B', isEnabled: true },
        { id: 'key-c', key: 'sk-c', label: 'C', isEnabled: false }
      ]
    })
  }

  async function readApiKeys() {
    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai'))
    return row?.apiKeys ?? []
  }

  it('adds a new API key as enabled and skips duplicate values', async () => {
    await seedProvider()

    const updated = await providerService.addApiKey('openai', 'sk-new', 'New key')
    expect(updated.apiKeys.map((entry) => entry.label)).toEqual(['A', 'B', 'C', 'New key'])
    expect(updated.apiKeys.at(-1)).toMatchObject({ label: 'New key', isEnabled: true })

    await providerService.addApiKey('openai', 'sk-new', 'Duplicate')
    const keys = await readApiKeys()
    expect(keys.filter((entry) => entry.key === 'sk-new')).toHaveLength(1)
  })

  it('preserves all API keys added by concurrent calls', async () => {
    await seedProvider()

    await Promise.all([
      providerService.addApiKey('openai', 'sk-oauth-a', 'OAuth'),
      providerService.addApiKey('openai', 'sk-oauth-b', 'OAuth'),
      providerService.addApiKey('openai', 'sk-oauth-c', 'OAuth')
    ])

    const keys = await readApiKeys()
    expect(keys.map((entry) => entry.key)).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-oauth-a', 'sk-oauth-b', 'sk-oauth-c'])
  })

  it('merges preset description and websites into the runtime provider read', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai-work',
      presetProviderId: 'openai',
      name: 'OpenAI Work',
      orderKey: generateOrderKeyBetween(null, null)
    })

    const provider = await providerService.getByProviderId('openai-work')

    expect(provider.description).toBe('OpenAI - AI model provider')
    expect(provider.websites).toMatchObject({
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models'
    })
  })

  it('updates API key fields and rejects empty or duplicate key values', async () => {
    await seedProvider()

    const updated = await providerService.updateApiKey('openai', 'key-a', {
      key: ' sk-updated ',
      label: '',
      isEnabled: false
    })

    expect(updated.apiKeys.find((entry) => entry.id === 'key-a')).toMatchObject({ isEnabled: false })
    const storedKeys = await readApiKeys()
    const storedKey = storedKeys.find((entry) => entry.id === 'key-a')
    expect(storedKey).toMatchObject({
      key: 'sk-updated',
      isEnabled: false
    })
    expect(storedKey?.label).toBeUndefined()

    await expect(providerService.updateApiKey('openai', 'key-a', { key: '   ' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
    await expect(providerService.updateApiKey('openai', 'key-a', { key: 'sk-b' })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('preserves independent fields changed by concurrent API key updates', async () => {
    await seedProvider()

    await Promise.all([
      providerService.updateApiKey('openai', 'key-a', { label: 'Updated A' }),
      providerService.updateApiKey('openai', 'key-b', { isEnabled: false })
    ])

    const keys = await readApiKeys()
    expect(keys.find((entry) => entry.id === 'key-a')).toMatchObject({ label: 'Updated A', isEnabled: true })
    expect(keys.find((entry) => entry.id === 'key-b')).toMatchObject({ label: 'B', isEnabled: false })
  })

  it('deletes API keys by id and persists the updated list', async () => {
    await seedProvider()

    const updated = await providerService.deleteApiKey('openai', 'key-b')

    expect(updated.apiKeys.map((entry) => entry.id)).toEqual(['key-a', 'key-c'])
    const storedKeys = await readApiKeys()
    expect(storedKeys.map((entry) => entry.id)).toEqual(['key-a', 'key-c'])
  })

  it('applies concurrent API key deletes without restoring removed entries', async () => {
    await seedProvider()

    await Promise.all([
      providerService.deleteApiKey('openai', 'key-a'),
      providerService.deleteApiKey('openai', 'key-b')
    ])

    const keys = await readApiKeys()
    expect(keys.map((entry) => entry.id)).toEqual(['key-c'])
  })

  it('allows deleting the last API key', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'single-key',
      name: 'Single Key',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: [{ id: 'only-key', key: 'sk-only', label: 'Only', isEnabled: true }]
    })

    const updated = await providerService.deleteApiKey('single-key', 'only-key')

    expect(updated.apiKeys).toEqual([])
    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'single-key'))
    expect(row.apiKeys).toEqual([])
  })

  it('throws NOT_FOUND when deleting a missing API key id', async () => {
    await seedProvider()

    await expect(providerService.deleteApiKey('openai', 'missing-key')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('replaces API keys through the dedicated key resource without changing provider metadata', async () => {
    await seedProvider()

    const replacement = [
      { id: 'key-new', key: ' sk-new ', label: 'New label', isEnabled: true },
      { id: 'key-disabled', key: 'sk-disabled', isEnabled: false }
    ]
    const updated = await providerService.replaceApiKeys('openai', replacement)

    expect(updated.name).toBe('OpenAI')
    expect(updated.apiKeys).toEqual([
      { id: 'key-new', label: 'New label', isEnabled: true },
      { id: 'key-disabled', isEnabled: false }
    ])
    const storedKeys = await readApiKeys()
    expect(storedKeys).toEqual([
      { id: 'key-new', key: 'sk-new', label: 'New label', isEnabled: true },
      { id: 'key-disabled', key: 'sk-disabled', isEnabled: false }
    ])
  })

  it('rejects invalid replacement API key entries before persisting', async () => {
    await seedProvider()

    await expect(
      providerService.replaceApiKeys('openai', [{ id: 'key-empty', key: '   ', isEnabled: true }])
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })

    await expect(
      providerService.replaceApiKeys('openai', [
        { id: 'key-a', key: 'sk-duplicate', isEnabled: true },
        { id: 'key-b', key: ' sk-duplicate ', isEnabled: false }
      ])
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })

    expect(await readApiKeys()).toEqual([
      { id: 'key-a', key: 'sk-a', label: 'A', isEnabled: true },
      { id: 'key-b', key: 'sk-b', label: 'B', isEnabled: true },
      { id: 'key-c', key: 'sk-c', label: 'C', isEnabled: false }
    ])
  })

  it('addApiKey and replaceApiKeys normalize whitespace-wrapped keys to the same stored shape', async () => {
    // Pins the C1 fix: AddProviderApiKeySchema + ReplaceProviderApiKeysSchema
    // both run inputs through trim().min(1) so whitespace-only keys are
    // rejected and surrounding whitespace is stripped. A future change that
    // reintroduces the raw-key field on either schema should fail this test.
    await dbh.db.insert(userProviderTable).values({
      providerId: 'parity-add',
      name: 'Parity Add',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: []
    })
    await dbh.db.insert(userProviderTable).values({
      providerId: 'parity-replace',
      name: 'Parity Replace',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: []
    })

    const addBody = AddProviderApiKeySchema.parse({ key: '  sk-shared  ', label: 'shared' })
    await providerService.addApiKey('parity-add', addBody.key, addBody.label)

    const replaceBody = ReplaceProviderApiKeysSchema.parse({
      keys: [{ id: 'replace-key-id', key: '  sk-shared  ', label: 'shared', isEnabled: true }]
    })
    await providerService.replaceApiKeys('parity-replace', replaceBody.keys)

    const readApiKeysFor = async (providerId: string) => {
      const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))
      return row?.apiKeys ?? []
    }

    const [addedKey] = await readApiKeysFor('parity-add')
    const [replacedKey] = await readApiKeysFor('parity-replace')

    expect(addedKey).toMatchObject({ key: 'sk-shared', label: 'shared', isEnabled: true })
    expect(replacedKey).toMatchObject({ key: 'sk-shared', label: 'shared', isEnabled: true })
    expect(addedKey.key).toBe(replacedKey.key)
    expect(addedKey.label).toBe(replacedKey.label)
    expect(addedKey.isEnabled).toBe(replacedKey.isEnabled)

    expect(() => AddProviderApiKeySchema.parse({ key: '   ' })).toThrow()
    expect(() => ReplaceProviderApiKeysSchema.parse({ keys: [{ id: 'k', key: '   ', isEnabled: true }] })).toThrow()
  })

  it('returns authConfig for an existing provider, null when absent, and NOT_FOUND when missing', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'azure',
      name: 'Azure OpenAI',
      orderKey: generateOrderKeyBetween(null, null),
      authConfig: { type: 'iam-azure', apiVersion: '2024-02-01' }
    })
    await dbh.db.insert(userProviderTable).values({
      providerId: 'custom-no-auth',
      name: 'Custom',
      orderKey: generateOrderKeyBetween(null, null),
      authConfig: null
    })

    await expect(providerService.getAuthConfig('azure')).resolves.toEqual({
      type: 'iam-azure',
      apiVersion: '2024-02-01'
    })
    await expect(providerService.getAuthConfig('custom-no-auth')).resolves.toBeNull()
    await expect(providerService.getAuthConfig('missing-provider')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('rotates enabled API keys and tolerates missing cached lastUsedKeyId', async () => {
    await seedProvider()

    await expect(providerService.getRotatedApiKey('openai')).resolves.toBe('sk-a')
    expect(MockMainCacheServiceUtils.getCacheValue('settings.provider.openai.last_used_key_id')).toBe('key-a')

    await expect(providerService.getRotatedApiKey('openai')).resolves.toBe('sk-b')
    expect(MockMainCacheServiceUtils.getCacheValue('settings.provider.openai.last_used_key_id')).toBe('key-b')

    MockMainCacheServiceUtils.setCacheValue('settings.provider.openai.last_used_key_id', 'deleted-key')
    await expect(providerService.getRotatedApiKey('openai')).resolves.toBe('sk-a')
    expect(MockMainCacheServiceUtils.getCacheValue('settings.provider.openai.last_used_key_id')).toBe('key-a')
  })

  it('returns the only enabled key or an empty string when rotation has no usable keys', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'single-enabled',
      name: 'Single Enabled',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: [
        { id: 'disabled-key', key: 'sk-disabled', isEnabled: false },
        { id: 'only-key', key: 'sk-only', isEnabled: true }
      ]
    })
    await dbh.db.insert(userProviderTable).values({
      providerId: 'all-disabled',
      name: 'All Disabled',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys: [
        { id: 'key-a', key: 'sk-a', isEnabled: false },
        { id: 'key-b', key: 'sk-b', isEnabled: false }
      ]
    })

    await expect(providerService.getRotatedApiKey('single-enabled')).resolves.toBe('sk-only')
    await expect(providerService.getRotatedApiKey('all-disabled')).resolves.toBe('')
  })
})
