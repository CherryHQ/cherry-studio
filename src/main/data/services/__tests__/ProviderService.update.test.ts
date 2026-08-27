// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode } from '@shared/data/api/errors'
import { CHERRYAI_PROVIDER_ID, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
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
        timeout: 30,
        rateLimit: 5
      }
    })

    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockClear()

    const updated = providerService.update('openai', {
      providerSettings: {
        apiVersion: '2026-01-01'
      }
    })

    // Lock the core fix: update() routes through withWriteTx (the serialized read-merge-write), not a
    // bare getDb() read-then-write. Without this, reverting that routing keeps every assertion green.
    expect(withWriteTx).toHaveBeenCalledTimes(1)

    // toEqual locks the exact shape so a future DEFAULT_PROVIDER_SETTINGS
    // leak into the row would immediately fail this test.
    expect(updated.settings).toEqual({
      timeout: 30,
      rateLimit: 5,
      apiVersion: '2026-01-01'
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'openai'))
    expect(row.providerSettings).toEqual({
      timeout: 30,
      rateLimit: 5,
      apiVersion: '2026-01-01'
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
      providerSettings: { timeout: 30 }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-null'))
    expect(row.providerSettings).toEqual({ timeout: 30 })
  })

  it('treats {} patch as a no-op for providerSettings', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-noop',
      name: 'P',
      orderKey: 'a0',
      providerSettings: { timeout: 30 }
    })

    providerService.update('p-noop', { providerSettings: {} })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-noop'))
    expect(row.providerSettings).toEqual({ timeout: 30 })
  })

  it('merges nested providerSettings without clobbering sibling keys', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-nested',
      name: 'P',
      orderKey: 'a0',
      providerSettings: {
        cacheControl: { enabled: true, tokenThreshold: 5_000, cacheLastNMessages: 2 }
      }
    })

    providerService.update('p-nested', {
      providerSettings: { cacheControl: { tokenThreshold: 20_000 } }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-nested'))
    expect(row.providerSettings).toEqual({
      cacheControl: { enabled: true, tokenThreshold: 20_000, cacheLastNMessages: 2 }
    })
  })

  it('removes nested and top-level providerSettings keys with null merge-patch values', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-delete',
      name: 'P',
      orderKey: 'a0',
      providerSettings: {
        notes: 'temporary',
        extraHeaders: { 'X-Keep': 'yes', 'X-Remove': 'no' }
      }
    })

    providerService.update('p-delete', {
      providerSettings: { notes: null, extraHeaders: { 'X-Remove': null } }
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-delete'))
    expect(row.providerSettings).toEqual({ extraHeaders: { 'X-Keep': 'yes' } })
  })

  it('drops a key when the patch sets it to undefined (reset-to-default)', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'p-undef',
      name: 'P',
      orderKey: 'a0',
      providerSettings: { timeout: 30, rateLimit: 5 }
    })

    providerService.update('p-undef', { providerSettings: { rateLimit: undefined } })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-undef'))
    // undefined overwrites the stored value in the merge, then the JSON write drops the key entirely.
    expect(row.providerSettings).toEqual({ timeout: 30 })
  })

  it('throws notFound when providerId does not exist', async () => {
    let err: unknown
    try {
      providerService.update('missing', { providerSettings: { timeout: 30 } })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it.each([
    ['CherryAI', CHERRYAI_PROVIDER_ID],
    ['Cherry Cloud', CHERRY_CLOUD_PROVIDER_ID]
  ])('rejects PATCHes for the managed %s provider', async (_name, providerId) => {
    await dbh.db.insert(userProviderTable).values({
      providerId,
      name: _name,
      orderKey: 'a0',
      isEnabled: true
    })

    let err: unknown
    try {
      providerService.update(providerId, { isEnabled: false })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: ErrorCode.INVALID_OPERATION,
      status: 400
    })

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))
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
      providerService.update('p-concurrent', { providerSettings: { timeout: 30 } })
      providerService.update('p-concurrent', { providerSettings: { rateLimit: 5 } })
    } finally {
      // Restore the default passthrough so the override doesn't leak into other tests.
      withWriteTx.mockImplementation((fn: (tx: unknown) => unknown) => fn(dbh.db))
    }

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'p-concurrent'))
    // Both keys survive — neither PATCH read a stale row and clobbered the other.
    expect(row.providerSettings).toEqual({ timeout: 30, rateLimit: 5 })
  })
})
