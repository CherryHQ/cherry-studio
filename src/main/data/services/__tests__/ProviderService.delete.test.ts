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
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { createUniqueModelId } from '@shared/data/types/model'
import type { Pin } from '@shared/data/types/pin'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ProviderService.delete — preset protection boundary', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should throw when deleting a canonical preset provider (providerId === presetProviderId)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      presetProviderId: 'openai',
      name: 'OpenAI',
      orderKey: generateOrderKeyBetween(null, null)
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
      name: 'OpenAI Work',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await expect(providerService.delete('openai-work')).resolves.toBeUndefined()

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai-work'))
    expect(rows).toHaveLength(0)
  })

  it('should NOT throw when deleting a fully custom provider with no presetProviderId', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'my-local-llm',
      presetProviderId: null,
      name: 'My Local LLM',
      orderKey: generateOrderKeyBetween(null, null)
    })

    await expect(providerService.delete('my-local-llm')).resolves.toBeUndefined()

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'my-local-llm'))
    expect(rows).toHaveLength(0)
  })

  it('should bulk purge pins for models owned by the deleted provider', async () => {
    const [openaiWorkOrderKey, anthropicWorkOrderKey, gpt4oOrderKey, o3OrderKey, claudeOrderKey] =
      generateOrderKeySequence(5)

    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'openai-work',
        presetProviderId: 'openai',
        name: 'OpenAI Work',
        orderKey: openaiWorkOrderKey
      },
      {
        providerId: 'anthropic-work',
        presetProviderId: 'anthropic',
        name: 'Anthropic Work',
        orderKey: anthropicWorkOrderKey
      }
    ])
    const targetModelIds = [createUniqueModelId('openai-work', 'gpt-4o'), createUniqueModelId('openai-work', 'o3')]
    const siblingModelId = createUniqueModelId('anthropic-work', 'claude-3')
    await dbh.db.insert(userModelTable).values([
      {
        id: targetModelIds[0],
        providerId: 'openai-work',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        orderKey: gpt4oOrderKey
      },
      {
        id: targetModelIds[1],
        providerId: 'openai-work',
        modelId: 'o3',
        name: 'o3',
        orderKey: o3OrderKey
      },
      {
        id: siblingModelId,
        providerId: 'anthropic-work',
        modelId: 'claude-3',
        name: 'Claude 3',
        orderKey: claudeOrderKey
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

  it('purges pins for every model under the provider as part of the delete transaction', async () => {
    const purgeForEntityTxSpy = vi.spyOn(pinService, 'purgeForEntityTx')
    const purgeForEntitiesTxSpy = vi.spyOn(pinService, 'purgeForEntitiesTx')
    const gpt4 = createUniqueModelId('openai-work', 'gpt-4')
    const gpt35 = createUniqueModelId('openai-work', 'gpt-3.5')
    const claude = createUniqueModelId('anthropic', 'claude-3')
    const openaiWorkOrderKey = generateOrderKeyBetween(null, null)
    const anthropicOrderKey = generateOrderKeyBetween(openaiWorkOrderKey, null)
    const [gpt4OrderKey, gpt35OrderKey, claudeOrderKey] = generateOrderKeySequence(3)

    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'openai-work',
        presetProviderId: 'openai',
        name: 'OpenAI Work',
        orderKey: openaiWorkOrderKey
      },
      {
        providerId: 'anthropic',
        presetProviderId: null,
        name: 'Anthropic',
        orderKey: anthropicOrderKey
      }
    ])
    await dbh.db.insert(userModelTable).values([
      { id: gpt4, providerId: 'openai-work', modelId: 'gpt-4', name: 'GPT-4', orderKey: gpt4OrderKey },
      { id: gpt35, providerId: 'openai-work', modelId: 'gpt-3.5', name: 'GPT-3.5', orderKey: gpt35OrderKey },
      { id: claude, providerId: 'anthropic', modelId: 'claude-3', name: 'Claude 3', orderKey: claudeOrderKey }
    ])
    await dbh.db.insert(pinTable).values([
      { entityType: 'model', entityId: gpt4, orderKey: 'a0' },
      { entityType: 'model', entityId: gpt35, orderKey: 'a1' },
      { entityType: 'model', entityId: claude, orderKey: 'a2' }
    ])

    await providerService.delete('openai-work')

    expect(purgeForEntitiesTxSpy).toHaveBeenCalledTimes(1)
    const [, entityType, entityIds] = purgeForEntitiesTxSpy.mock.calls[0]
    expect(entityType).toBe('model')
    expect(entityIds).toHaveLength(2)
    expect(new Set(entityIds)).toEqual(new Set([gpt4, gpt35]))
    expect(purgeForEntityTxSpy).not.toHaveBeenCalled()

    // Pins for the deleted provider's models are gone.
    const deletedProviderPins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, gpt4))
    expect(deletedProviderPins).toHaveLength(0)
    const gpt35Pins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, gpt35))
    expect(gpt35Pins).toHaveLength(0)

    // Other providers' pins are untouched.
    const survivingPins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, claude))
    expect(survivingPins).toHaveLength(1)
  })

  it('throws notFound when the provider row does not exist (no silent zero-row delete)', async () => {
    await expect(providerService.delete('does-not-exist')).rejects.toThrow(/not found/i)
  })
})
