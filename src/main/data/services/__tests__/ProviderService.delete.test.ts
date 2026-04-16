/**
 * Regression tests for ProviderService.delete — preset provider protection boundary.
 *
 * Regression: The guard `provider.presetProviderId === providerId` was previously
 * absent, allowing canonical preset providers ('openai', 'anthropic', etc.) to be
 * deleted directly. User-created copies that inherit from a preset must still be
 * deletable.
 */

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
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
})
