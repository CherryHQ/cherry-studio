import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/apiErrors'
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

    // toEqual locks the exact shape so a future DEFAULT_PROVIDER_SETTINGS
    // leak into the row would immediately fail this test.
    expect(updated.settings).toEqual({
      serviceTier: 'auto',
      verbosity: 'low',
      summaryText: 'detailed'
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai'))
    expect(row.providerSettings).toEqual({
      serviceTier: 'auto',
      verbosity: 'low',
      summaryText: 'detailed'
    })
  })

  it('writes only the patch when stored providerSettings is null', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-null',
      name: 'P',
      providerSettings: null
    })

    await providerService.update('p-null', {
      providerSettings: { serviceTier: 'auto' }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-null'))
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('treats {} patch as a no-op for providerSettings', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-noop',
      name: 'P',
      providerSettings: { serviceTier: 'auto' }
    })

    await providerService.update('p-noop', { providerSettings: {} })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-noop'))
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('throws notFound when providerId does not exist', async () => {
    await expect(
      providerService.update('missing', { providerSettings: { serviceTier: 'auto' } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })
})
