import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/apiErrors'
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

    const updated = await providerService.update('openai', {
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
      orderKey: 'a0',
      providerSettings: { serviceTier: 'auto' }
    })

    await providerService.update('p-noop', { providerSettings: {} })

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

    await providerService.update('p-null-override', { providerSettings: { summaryText: null } })

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

    await providerService.update('p-undef', { providerSettings: { summaryText: undefined } })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-undef'))
    // undefined overwrites the stored value in the merge, then the JSON write drops the key entirely.
    expect(row.providerSettings).toEqual({ serviceTier: 'auto' })
  })

  it('throws notFound when providerId does not exist', async () => {
    await expect(
      providerService.update('missing', { providerSettings: { serviceTier: 'auto' } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('serializes concurrent PATCHes so neither clobbers the other (read-merge-write inside the tx)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-concurrent',
      name: 'P',
      orderKey: 'a0',
      providerSettings: {}
    })

    // Give the withWriteTx mock the production mutex (serialize callbacks). This is what the
    // call-count assertion can't: it distinguishes read-merge-write INSIDE the tx from a partial
    // revert that moves the SELECT outside it — if the read leaks out of serialization, both PATCHes
    // read `{}` and the second write clobbers the first.
    const withWriteTx = application.get('DbService').withWriteTx as Mock
    let chain: Promise<unknown> = Promise.resolve()
    withWriteTx.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn(dbh.db))
      chain = run.catch(() => {})
      return run
    })

    try {
      await Promise.all([
        providerService.update('p-concurrent', { providerSettings: { serviceTier: 'auto' } }),
        providerService.update('p-concurrent', { providerSettings: { verbosity: 'low' } })
      ])
    } finally {
      // Restore the default passthrough so the mutex doesn't leak into other tests.
      withWriteTx.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(dbh.db))
    }

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-concurrent'))
    // Both keys survive — neither PATCH read a stale row and clobbered the other.
    expect(row.providerSettings).toEqual({ serviceTier: 'auto', verbosity: 'low' })
  })
})
