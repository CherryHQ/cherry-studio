import { resolve } from 'node:path'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { clearProviderPresetDisplayMetadataCache } from '@data/services/ProviderRegistryMetadata'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ProviderService API keys', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    clearProviderPresetDisplayMetadataCache()
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
})
