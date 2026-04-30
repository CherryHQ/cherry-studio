import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
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

  async function seedProvidersWithGrok() {
    const [openaiKey, anthropicKey, geminiKey, grokKey] = generateOrderKeySequence(4)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI', orderKey: openaiKey },
      { providerId: 'anthropic', name: 'Anthropic', orderKey: anthropicKey },
      { providerId: 'gemini', name: 'Gemini', orderKey: geminiKey },
      { providerId: 'grok', name: 'Grok', orderKey: grokKey }
    ])
  }

  async function readOrder() {
    const rows = await dbh.db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
    return rows.map((row) => row.providerId)
  }

  it('creates new providers at the end of the list', async () => {
    await seedProviders()

    await providerService.create({ providerId: 'grok', name: 'Grok' })

    const rows = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'grok')).limit(1)

    expect(rows[0]?.orderKey).toBeTruthy()
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

    await expect(providerService.move('missing', { position: 'first' })).rejects.toThrow(/missing/)
  })

  it('throws when anchor provider does not exist', async () => {
    await seedProviders()

    await expect(providerService.move('openai', { after: 'missing' })).rejects.toThrow(/missing/)
  })
})
