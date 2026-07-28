// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/errors'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, type Mock } from 'vitest'

describe('ProviderService.update', () => {
  const dbh = setupTestDatabase()

  it('merges providerSettings patches without dropping existing settings', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      orderKey: 'a0',
      providerSettings: {
        serviceTier: 'auto',
        verbosity: 'low'
      }
    })

    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockClear()

    const updated = providerService.update('openai', {
      providerSettings: {
        summaryText: 'detailed'
      }
    })

    // Lock the core fix: update() routes through withWriteTx (the serialized read-merge-write), not a
    // bare getDb() read-then-write. Without this, reverting that routing keeps every assertion green.
    expect(withWriteTx).toHaveBeenCalledTimes(1)

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
      orderKey: 'a0',
      providerSettings: null
    })

    providerService.update('p-null', {
      providerSettings: { serviceTier: 'auto' }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-null'))
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('treats {} patch as a no-op for providerSettings', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-noop',
      name: 'P',
      orderKey: 'a0',
      providerSettings: { serviceTier: 'auto' }
    })

    providerService.update('p-noop', { providerSettings: {} })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-noop'))
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('persists an explicit null override over a stored value (PATCH clear marker)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-null-override',
      name: 'P',
      orderKey: 'a0',
      providerSettings: { summaryText: 'auto' }
    })

    providerService.update('p-null-override', { providerSettings: { summaryText: null } })

    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, 'p-null-override'))
    // null wins over the stored 'auto' and is persisted as the explicit clear marker (not stripped).
    expect(row.providerSettings).toEqual({ summaryText: null })
  })

  it('drops a key when the patch sets it to undefined (reset-to-default)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-undef',
      name: 'P',
      orderKey: 'a0',
      providerSettings: { serviceTier: 'auto', summaryText: 'detailed' }
    })

    providerService.update('p-undef', { providerSettings: { summaryText: undefined } })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-undef'))
    // undefined overwrites the stored value in the merge, then the JSON write drops the key entirely.
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('throws notFound when providerId does not exist', async () => {
    let err: unknown
    try {
      providerService.update('missing', { providerSettings: { serviceTier: 'auto' } })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('rejects PATCHes for the managed CherryAI provider', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      orderKey: 'a0',
      isEnabled: true
    })

    let err: unknown
    try {
      providerService.update(CHERRYAI_PROVIDER_ID, { isEnabled: false })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: ErrorCode.INVALID_OPERATION,
      status: 400
    })

    const [row] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
    expect(row.isEnabled).toBe(true)
  })

  it('serializes concurrent PATCHes so neither clobbers the other (read-merge-write inside the tx)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-concurrent',
      name: 'P',
      orderKey: 'a0',
      providerSettings: {}
    })

    // Route the (now synchronous) withWriteTx through the real test DB. Because update() reads,
    // merges, and writes inside a single synchronous withWriteTx callback, each PATCH runs to
    // completion before the next begins — the second merges on the row the first just wrote,
    // so neither clobbers the other's keys.
    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockImplementation((fn: (tx: unknown) => unknown) => fn(dbh.db))

    try {
      providerService.update('p-concurrent', { providerSettings: { serviceTier: 'auto' } })
      providerService.update('p-concurrent', { providerSettings: { verbosity: 'low' } })
    } finally {
      // Restore the default passthrough so the override doesn't leak into other tests.
      withWriteTx.mockImplementation((fn: (tx: unknown) => unknown) => fn(dbh.db))
    }

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-concurrent'))
    // Both keys survive — neither PATCH read a stale row and clobbered the other.
    expect(row.providerSettings).toEqual({ serviceTier: 'auto', verbosity: 'low' })
  })
})
