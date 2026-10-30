import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

it('reads a coherent native context without resuming, writing, or borrowing another branch', async () => {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const native = await Harness.open(
    new MemoryStorage(),
    { models, registry: createRegistry(), settings: { compaction: { enabled: false } } },
    context
  )
  try {
    const root = await native.createConversation(
      { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
      context
    )
    const at = await native.commit(
      (tx) =>
        tx.appendEntry(root.id, { kind: 'test.context', model: [{ role: 'user', content: '12345678', timestamp: 1 }] }),
      context
    )
    const scheduler = await native.inspect(context)
    const ledger = await native.usage(context)
    const usage = await root.contextUsage(context)
    expect(usage?.tokens).toBe(3)
    expect(usage?.compactionThreshold).toBeUndefined()
    expect(await root.contextUsage(context)).toEqual(usage)
    expect(await native.inspect(context)).toEqual(scheduler)
    expect(await native.usage(context)).toEqual(ledger)
    const child = await root.fork(at.id, { ownership: { kind: 'ownerless' } }, context)
    await native.commit(
      (tx) =>
        tx.appendEntry(child.id, {
          kind: 'pi.reset',
          head: 'self',
          model: [{ role: 'user', content: '1234', timestamp: 2 }]
        }),
      context
    )
    expect((await child.contextUsage(context))?.tokens).toBe(2)
    expect((await root.contextUsage(context))?.tokens).toBe(3)
    await root.configure({ model: null }, context)
    expect(await root.contextUsage(context)).toBeUndefined()
    expect((await child.contextUsage(context))?.tokens).toBe(2)
  } finally {
    await native.close(context)
  }
})
