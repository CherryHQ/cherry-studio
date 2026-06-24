// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/ProviderRegistryService'

import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

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

    const created = await providerService.create({ providerId: 'grok', name: 'Grok' })

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'grok')).limit(1)

    expect(rows[0]?.orderKey).toBeTruthy()
    // New providers are created disabled; the auto-enable flow turns them on once models exist.
    expect(created.isEnabled).toBe(false)
    expect(rows[0]?.isEnabled).toBe(false)
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', 'grok'])
  })

  it('batchUpsert appends only missing providers in input order', async () => {
    await seedProviders()

    await providerService.batchUpsert([
      { providerId: 'anthropic', name: 'Anthropic duplicate' },
      { providerId: 'grok', name: 'Grok' },
      { providerId: 'openrouter', name: 'OpenRouter' }
    ])

    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', 'grok', 'openrouter'])
  })

  it('moves a provider to the first position', async () => {
    await seedProviders()

    await providerService.move('gemini', { position: 'first' })

    expect(await readOrder()).toEqual(['gemini', 'openai', 'anthropic'])
  })

  it('moves a provider after an anchor', async () => {
    await seedProviders()

    await providerService.move('openai', { after: 'gemini' })

    expect(await readOrder()).toEqual(['anthropic', 'gemini', 'openai'])
  })

  it('moves a provider before an anchor', async () => {
    // The reorder suite previously covered only `after` and `position`,
    // leaving the `before` branch of applyMoves uncovered. With the seeded
    // order [openai, anthropic, gemini], moving openai before gemini should
    // place it immediately before gemini, between anthropic and gemini.
    await seedProviders()

    await providerService.move('openai', { before: 'gemini' })

    expect(await readOrder()).toEqual(['anthropic', 'openai', 'gemini'])
  })

  it('rejects a before-anchor that equals the move target', async () => {
    await seedProviders()

    await expect(providerService.move('openai', { before: 'openai' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
  })

  it('applies batch moves sequentially', async () => {
    await seedProviders()

    await providerService.reorder([
      { id: 'gemini', anchor: { position: 'first' } },
      { id: 'openai', anchor: { after: 'gemini' } }
    ])

    expect(await readOrder()).toEqual(['gemini', 'openai', 'anthropic'])
  })

  it('throws when target provider does not exist', async () => {
    await seedProviders()

    await expect(providerService.move('missing', { position: 'first' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      details: { resource: 'Provider', id: 'missing' }
    })
  })

  it('throws when anchor provider does not exist', async () => {
    await seedProviders()

    await expect(providerService.move('openai', { after: 'missing' })).rejects.toMatchObject({
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

    await expect(providerService.move(CHERRYAI_PROVIDER_ID, { position: 'first' })).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
    await expect(
      providerService.reorder([{ id: CHERRYAI_PROVIDER_ID, anchor: { position: 'last' } }])
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
    expect(await readOrder()).toEqual(['openai', 'anthropic', 'gemini', CHERRYAI_PROVIDER_ID])
  })
})
