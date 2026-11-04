import { setupTestDatabase } from '@test-helpers/db'
import { asc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'

describe('ProviderService.batchUpsert — legacy invalid order keys (#21282)', () => {
  const dbh = setupTestDatabase()

  it('re-keys a legacy order_key=zz row instead of aborting the startup registry sync', async () => {
    // Older releases wrote 'zz' as the end-of-list sentinel; the
    // fractional-indexing generator rejects it. The boot-time preset provider
    // sync (PresetProviderSeeder → batchUpsertTx) must survive such a row.
    dbh.db.insert(userProviderTable).values({ providerId: 'legacy-provider', name: 'Legacy', orderKey: 'zz' }).run()

    expect(() => providerService.batchUpsert([{ providerId: 'sync-new', name: 'Sync New' }])).not.toThrow()

    const rows = await dbh.db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
    expect(rows.map((r) => r.providerId)).toEqual(['legacy-provider', 'sync-new'])
    const legacy = rows.find((r) => r.providerId === 'legacy-provider')!
    expect(legacy.orderKey).not.toBe('zz')
    // The re-keyed value is accepted by the library's own generator.
    expect(() => generateOrderKeyBetween(legacy.orderKey, null)).not.toThrow()
  })
})
