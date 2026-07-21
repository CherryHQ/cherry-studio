// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api/errors'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq, sql } from 'drizzle-orm'
import { describe, expect, it, type Mock } from 'vitest'

describe('ProviderService reorder', () => {
  const dbh = setupTestDatabase()

  async function seedProviders() {
    const [openaiKey, anthropicKey, geminiKey] = generateOrderKeySequence(3)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI', orderKey: openaiKey },
      { providerId: 'anthropic', name: 'Anthropic', orderKey: anthropicKey },
      { providerId: 'gemini', name: 'Gemini', orderKey: geminiKey }
    ])
  }

  async function readOrder() {
    const rows = await dbh.db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
    return rows.map((row) => row.providerId)
  }

  it('creates new providers at the end of the list', async () => {
    await seedProviders()

    const created = providerService.create({ providerId: 'grok', name: 'Grok' })

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'grok')).limit(1)

    expect(rows[0]?.orderKey).toBeTruthy()
    // New providers are created disabled; the auto-enable flow turns them on once models exist.
    expect(created.isEnabled).toBe(false)
    expect(rows[0]?.isEnabled).toBe(false)
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', 'grok'])
  })

  it('batchUpsert appends only missing providers in input order', async () => {
    await seedProviders()

    providerService.batchUpsert([
      { providerId: 'anthropic', name: 'Anthropic duplicate' },
      { providerId: 'grok', name: 'Grok' },
      { providerId: 'openrouter', name: 'OpenRouter' }
    ])

    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', 'grok', 'openrouter'])
  })

  it('moves a provider to the first position', async () => {
    await seedProviders()

    providerService.move('gemini', { position: 'first' })

    expect(await readOrder()).toEqual(['gemini', 'openai', 'anthropic'])
  })

  it('moves a provider to the first position when update enables it', async () => {
    await seedProviders()

    const updated = providerService.update('gemini', { isEnabled: true, name: 'Gemini OAuth' })

    expect(updated.isEnabled).toBe(true)
    expect(updated.name).toBe('Gemini OAuth')
    expect(await readOrder()).toEqual(['gemini', 'openai', 'anthropic'])

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'gemini'))
    expect(row.isEnabled).toBe(true)
    expect(row.name).toBe('Gemini OAuth')
  })

  it('rolls back the order move when the enable update fails', async () => {
    await seedProviders()

    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockImplementationOnce((fn: (tx: unknown) => unknown) => dbh.db.transaction(fn as never))
    dbh.db.run(
      sql.raw(`
      CREATE TRIGGER fail_provider_enable_update
      BEFORE UPDATE OF is_enabled ON user_provider
      WHEN NEW.provider_id = 'gemini'
      BEGIN
        SELECT RAISE(ABORT, 'forced provider enable update failure');
      END;
    `)
    )

    try {
      expect(() => providerService.update('gemini', { isEnabled: true })).toThrow(
        'forced provider enable update failure'
      )
    } finally {
      dbh.db.run(sql.raw('DROP TRIGGER IF EXISTS fail_provider_enable_update'))
    }

    const [row] = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'gemini'))
    expect(row.isEnabled).toBe(false)
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini'])
  })

  it('preserves user order when update receives a redundant enabled state', async () => {
    await seedProviders()
    await dbh.db.update(userProviderTable).set({ isEnabled: true }).where(eq(userProviderTable.providerId, 'gemini'))

    const updated = providerService.update('gemini', { isEnabled: true })

    expect(updated.isEnabled).toBe(true)
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini'])
  })

  it('preserves user order when update disables a provider', async () => {
    await seedProviders()
    await dbh.db.update(userProviderTable).set({ isEnabled: true }).where(eq(userProviderTable.providerId, 'gemini'))

    const updated = providerService.update('gemini', { isEnabled: false })

    expect(updated.isEnabled).toBe(false)
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini'])
  })

  it('moves a provider after an anchor', async () => {
    await seedProviders()

    providerService.move('openai', { after: 'gemini' })

    expect(await readOrder()).toEqual(['anthropic', 'gemini', 'openai'])
  })

  it('moves a provider before an anchor', async () => {
    // The reorder suite previously covered only `after` and `position`,
    // leaving the `before` branch of applyMoves uncovered. With the seeded
    // order [openai, anthropic, gemini], moving openai before gemini should
    // place it immediately before gemini, between anthropic and gemini.
    await seedProviders()

    providerService.move('openai', { before: 'gemini' })

    expect(await readOrder()).toEqual(['anthropic', 'openai', 'gemini'])
  })

  it('rejects a before-anchor that equals the move target', async () => {
    await seedProviders()

    let err: unknown
    try {
      providerService.move('openai', { before: 'openai' })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: ErrorCode.INVALID_ANCHOR
    })
  })

  it('applies batch moves sequentially', async () => {
    await seedProviders()

    providerService.reorder([
      { id: 'gemini', anchor: { position: 'first' } },
      { id: 'openai', anchor: { after: 'gemini' } }
    ])

    expect(await readOrder()).toEqual(['gemini', 'openai', 'anthropic'])
  })

  it('throws when target provider does not exist', async () => {
    await seedProviders()

    let err: unknown
    try {
      providerService.move('missing', { position: 'first' })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: ErrorCode.NOT_FOUND,
      details: { resource: 'Provider', id: 'missing' }
    })
  })

  it('throws when anchor provider does not exist', async () => {
    await seedProviders()

    let err: unknown
    try {
      providerService.move('openai', { after: 'missing' })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({
      code: ErrorCode.NOT_FOUND,
      details: { resource: 'Provider', id: 'missing' }
    })
  })

  it('rejects moving the managed CherryAI provider', async () => {
    await seedProviders()
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      orderKey: 'z0',
      isEnabled: true
    })

    let moveErr: unknown
    try {
      providerService.move(CHERRYAI_PROVIDER_ID, { position: 'first' })
    } catch (e) {
      moveErr = e
    }
    expect(moveErr).toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
    let reorderErr: unknown
    try {
      providerService.reorder([{ id: CHERRYAI_PROVIDER_ID, anchor: { position: 'last' } }])
    } catch (e) {
      reorderErr = e
    }
    expect(reorderErr).toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', CHERRYAI_PROVIDER_ID])
  })
})
