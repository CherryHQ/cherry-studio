import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('ProviderService.update', () => {
  const dbh = setupTestDatabase()

  it('merges providerSettings patches without dropping existing settings', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      providerSettings: {
        serviceTier: 'auto',
        verbosity: 'low'
      }
    })

    const updated = await providerService.update('openai', {
      providerSettings: {
        summaryText: 'detailed'
      }
    })

    expect(updated.settings).toMatchObject({
      serviceTier: 'auto',
      verbosity: 'low',
      summaryText: 'detailed'
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai'))
    expect(row.providerSettings).toMatchObject({
      serviceTier: 'auto',
      verbosity: 'low',
      summaryText: 'detailed'
    })
  })
})
