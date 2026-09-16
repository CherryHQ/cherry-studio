import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const ruleId = 'tx-boundary/no-ambient-db-in-tx'

async function diagnostics(code: string, file = 'ModelService.ts') {
  const [result] = await eslint.lintText(code, { filePath: `src/main/data/services/${file}` })
  expect(result.messages.filter((message) => message.fatal)).toEqual([])
  return result.messages.filter((message) => message.ruleId === ruleId)
}

describe('transaction boundary lint gate', () => {
  it('blocks a global database lookup in a transaction method as an error', async () => {
    const messages = await diagnostics(`
      class ModelService {
        findByIdTx(tx, id) { return application.get('DbService').getDb().select(id) }
      }
    `)
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 2, messageId: 'ambientDb' })]))
  })

  it('blocks transaction escape through multiple same-class helpers', async () => {
    const messages = await diagnostics(`
      class ModelService {
        findByIdTx(tx, id) { return this.enrich(id) }
        enrich(id) { return this.lookup(id) }
        lookup(id) { return providerRegistryService.lookupModel('provider', id) }
      }
    `)
    expect(messages).toEqual([expect.objectContaining({ severity: 2, messageId: 'serviceEscape', line: 5 })])
  })

  it('blocks global database access through a same-class getter', async () => {
    const messages = await diagnostics(`
      class ModelService {
        get db() { return application.get('DbService').getDb() }
        findByIdTx(tx, id) { return this.db.select(id) }
      }
    `)
    expect(messages.some((message) => message.severity === 2 && message.messageId === 'ambientDb')).toBe(true)
  })

  it('checks callbacks in a helper reached from a transaction', async () => {
    const messages = await diagnostics(`
      class ModelService {
        listTx(tx, ids) { return this.enrich(ids) }
        enrich(ids) { return ids.map(id => providerService.getByProviderId(id)) }
      }
    `)
    expect(messages).toEqual([expect.objectContaining({ severity: 2, messageId: 'serviceEscape' })])
  })

  it('allows caller-owned reads followed by explicit-context resolution', async () => {
    expect(
      await diagnostics(`
      class ModelService {
        findByIdTx(tx, id) {
          const context = providerService.getReasoningContextsByProviderIdsTx(tx, [id]).get(id)
          return this.enrich(context, id)
        }
        enrich(context, id) { return providerRegistryService.resolveModel(context, id) }
      }
    `)
    ).toEqual([])
  })

  it('blocks reintroducing a service lookup behind the explicit-context resolver', async () => {
    const messages = await diagnostics(
      `
      class ProviderRegistryService {
        resolveModel(context, id) { return this.getContext(context.id) }
        getContext(id) { return getDataService('ProviderService').getByProviderId(id) }
      }
    `,
      'ProviderRegistryService.ts'
    )
    expect(messages).toEqual([expect.objectContaining({ severity: 2, messageId: 'contextLookup' })])
  })

  it('permits the runtime convenience wrapper to acquire provider context', async () => {
    expect(
      await diagnostics(
        `
      class ProviderRegistryService {
        lookupModel(id) { return this.getContext(id) }
        getContext(id) { return getDataService('ProviderService').getByProviderId(id) }
        resolveModel(context, id) { return { context, id } }
      }
    `,
        'ProviderRegistryService.ts'
      )
    ).toEqual([])
  })

  it('handles recursive helpers without confusing methods on another class', async () => {
    expect(
      await diagnostics(`
      class ModelService {
        listTx(tx, rows) { return this.enrich(rows) }
        enrich(rows) { return rows.length ? this.enrich(rows.slice(1)) : rows }
      }
      class OtherService {
        enrich() { return application.get('DbService').getDb() }
      }
    `)
    ).toEqual([])
  })
})
