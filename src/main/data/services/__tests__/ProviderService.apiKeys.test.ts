import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ProviderService API keys', () => {
  const dbh = setupTestDatabase()

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
