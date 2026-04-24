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
import { providerService } from '@data/services/ProviderService'
import { createUniqueModelId } from '@shared/data/types/model'
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

  it('purges pins for every model under the provider as part of the delete transaction', async () => {
    const gpt4 = createUniqueModelId('openai-work', 'gpt-4')
    const gpt35 = createUniqueModelId('openai-work', 'gpt-3.5')
    const claude = createUniqueModelId('anthropic', 'claude-3')

    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai-work', presetProviderId: 'openai', name: 'OpenAI Work' },
      { providerId: 'anthropic', presetProviderId: null, name: 'Anthropic' }
    ])
    await dbh.db.insert(userModelTable).values([
      { id: gpt4, providerId: 'openai-work', modelId: 'gpt-4', name: 'GPT-4' },
      { id: gpt35, providerId: 'openai-work', modelId: 'gpt-3.5', name: 'GPT-3.5' },
      { id: claude, providerId: 'anthropic', modelId: 'claude-3', name: 'Claude 3' }
    ])
    await dbh.db.insert(pinTable).values([
      { entityType: 'model', entityId: gpt4, orderKey: 'a0' },
      { entityType: 'model', entityId: gpt35, orderKey: 'a1' },
      { entityType: 'model', entityId: claude, orderKey: 'a2' }
    ])

    await providerService.delete('openai-work')

    // Pins for the deleted provider's models are gone.
    const deletedProviderPins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, gpt4))
    expect(deletedProviderPins).toHaveLength(0)
    const gpt35Pins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, gpt35))
    expect(gpt35Pins).toHaveLength(0)

    // Other providers' pins are untouched.
    const survivingPins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, claude))
    expect(survivingPins).toHaveLength(1)
  })
})
