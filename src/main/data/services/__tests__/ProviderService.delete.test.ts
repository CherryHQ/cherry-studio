/**
 * Regression tests for ProviderService.delete — preset provider protection boundary.
 *
 * Regression: The guard `provider.presetProviderId === providerId` was previously
 * absent, allowing canonical preset providers ('openai', 'anthropic', etc.) to be
 * deleted directly. User-created copies that inherit from a preset must still be
 * deletable.
 */

import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { pinService } from '@data/services/PinService'
import { providerService } from '@data/services/ProviderService'
import { createUniqueModelId } from '@shared/data/types/model'
import type { Pin } from '@shared/data/types/pin'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ProviderService.delete — preset protection boundary', () => {
  const dbh = setupTestDatabase()

  it('should throw when deleting a canonical preset provider (providerId === presetProviderId)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      presetProviderId: 'openai',
      name: 'OpenAI'
    })

    await expect(providerService.delete('openai')).rejects.toThrow(/Cannot delete preset provider/)

    // Verify row is still present
    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai'))
    expect(rows).toHaveLength(1)
  })

  it('should NOT throw when deleting a user-created provider that inherits from a preset', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai-work',
      presetProviderId: 'openai',
      name: 'OpenAI Work'
    })

    await expect(providerService.delete('openai-work')).resolves.toBeUndefined()

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai-work'))
    expect(rows).toHaveLength(0)
  })

  it('should NOT throw when deleting a fully custom provider with no presetProviderId', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'my-local-llm',
      presetProviderId: null,
      name: 'My Local LLM'
    })

    await expect(providerService.delete('my-local-llm')).resolves.toBeUndefined()

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'my-local-llm'))
    expect(rows).toHaveLength(0)
  })

  it('should bulk purge pins for models owned by the deleted provider', async () => {
    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'openai-work',
        presetProviderId: 'openai',
        name: 'OpenAI Work'
      },
      {
        providerId: 'anthropic-work',
        presetProviderId: 'anthropic',
        name: 'Anthropic Work'
      }
    ])
    const targetModelIds = [createUniqueModelId('openai-work', 'gpt-4o'), createUniqueModelId('openai-work', 'o3')]
    const siblingModelId = createUniqueModelId('anthropic-work', 'claude-3')
    await dbh.db.insert(userModelTable).values([
      {
        id: targetModelIds[0],
        providerId: 'openai-work',
        modelId: 'gpt-4o',
        name: 'GPT-4o'
      },
      {
        id: targetModelIds[1],
        providerId: 'openai-work',
        modelId: 'o3',
        name: 'o3'
      },
      {
        id: siblingModelId,
        providerId: 'anthropic-work',
        modelId: 'claude-3',
        name: 'Claude 3'
      }
    ])
    const targetPins: Pin[] = []
    for (const entityId of targetModelIds) {
      targetPins.push(await pinService.pin({ entityType: 'model', entityId }))
    }
    const siblingPin = await pinService.pin({ entityType: 'model', entityId: siblingModelId })

    await providerService.delete('openai-work')

    const pins = await dbh.db.select().from(pinTable)
    for (const pin of targetPins) {
      expect(pins.find((row) => row.id === pin.id)).toBeUndefined()
    }
    expect(pins.find((row) => row.id === siblingPin.id)).toBeDefined()
  })
})
