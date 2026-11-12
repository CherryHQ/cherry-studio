import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry, type CompactionSettings } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { readContextUsage } from '../src/contextUsage'

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

it('keeps a fork on its committed resource snapshot after the parent prompt changes', async () => {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const native = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, context)
  try {
    const root = await native.createConversation(
      { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
      context
    )
    const at = await native.commit(
      (tx) =>
        tx.appendEntry(root.id, {
          kind: 'pi.system',
          model: [
            {
              role: 'system',
              content: '',
              timestamp: 1,
              sections: { skills: 'Skill summary' },
              contextSources: {
                sections: {
                  skills: {
                    kind: 'skills',
                    resources: [{ id: 'skill', name: 'Original skill', source: '/skills/example', characters: 13 }]
                  }
                },
                tools: {}
              }
            }
          ]
        }),
      context
    )
    const child = await root.fork(at.id, { ownership: { kind: 'ownerless' } }, context)
    await native.commit(
      (tx) =>
        tx.appendEntry(root.id, {
          kind: 'pi.system',
          model: [
            {
              role: 'system',
              content: '',
              timestamp: 2,
              sections: { skills: null }
            }
          ]
        }),
      context
    )
    const childUsage = await readContextUsage(child)
    const rootUsage = await readContextUsage(root)
    expect(childUsage.status === 'confirmed' && childUsage.value.resources).toContainEqual(
      expect.objectContaining({
        name: 'Original skill',
        category: 'skills',
        count: { tokens: 4, precision: 'estimated' }
      })
    )
    expect(
      rootUsage.status === 'confirmed' && rootUsage.value.resources?.some((resource) => resource.category === 'skills')
    ).toBe(false)
  } finally {
    await native.close(context)
  }
})

it('uses the selected model compaction policy for thresholds and revisions', async () => {
  const models = createModels()
  models.setProvider(fauxProvider({ models: [{ id: 'faux-1', contextWindow: 128_000 }] }).provider)
  let compaction: CompactionSettings = {
    enabled: true,
    reserveTokens: 10_000,
    modelOverrides: {}
  }
  const native = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry: createRegistry(),
      settings: () => ({ compaction })
    },
    context
  )
  try {
    const root = await native.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: { model: { provider: 'faux', modelId: 'faux-1' } }
      },
      context
    )
    const initial = await root.contextUsage(context)
    expect(initial?.compactionThreshold).toBe(118_000)
    compaction = { ...compaction, modelOverrides: { 'faux/faux-1': { reserveTokens: 30_000 } } }
    const overridden = await root.contextUsage(context)
    expect(overridden?.compactionThreshold).toBe(98_000)
    expect(overridden?.revision).not.toBe(initial?.revision)
    compaction = {
      ...compaction,
      modelOverrides: { ...compaction.modelOverrides, 'faux/other': { enabled: false } }
    }
    expect(await root.contextUsage(context)).toEqual(overridden)
    compaction = { ...compaction, modelOverrides: { 'faux/faux-1': { enabled: false, reserveTokens: 30_000 } } }
    const disabled = await root.contextUsage(context)
    expect(disabled?.compactionThreshold).toBeUndefined()
    expect(disabled?.revision).not.toBe(overridden?.revision)
  } finally {
    await native.close(context)
  }
})

it('reflects conversation compaction overrides without changing sibling policies', async () => {
  const models = createModels()
  models.setProvider(fauxProvider({ models: [{ id: 'faux-1', contextWindow: 128_000 }] }).provider)
  const native = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry: createRegistry(),
      settings: { compaction: { enabled: true, reserveTokens: 10_000 } }
    },
    context
  )
  try {
    const root = await native.createConversation(
      { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
      context
    )
    const sibling = await native.createConversation(
      { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
      context
    )
    expect((await root.contextUsage(context))?.compactionThreshold).toBe(118_000)
    await root.configure({ compaction: { reserveTokens: 30_000 } }, context)
    expect((await root.contextUsage(context))?.compactionThreshold).toBe(98_000)
    expect((await sibling.contextUsage(context))?.compactionThreshold).toBe(118_000)
    await root.configure({ compaction: { enabled: false } }, context)
    expect((await root.contextUsage(context))?.compactionThreshold).toBeUndefined()
    await root.configure({ compaction: null }, context)
    expect((await root.contextUsage(context))?.compactionThreshold).toBe(118_000)
  } finally {
    await native.close(context)
  }
})
