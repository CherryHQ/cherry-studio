import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { CompactionEntry, createRegistry, Harness, MemoryStorage, UserEntry } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { areDurableInputsAbsent, readDurableReply } from '../src/replyHistory'

it('keeps a delivery pending when a linked input has a legacy receipt or a receipt has no recoverable identity', async () => {
  const ctx = BACKGROUND_CONTEXT
  const storage = new MemoryStorage()
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  let finish!: () => void
  const gate = new Promise<void>((resolve) => (finish = resolve))
  faux.setResponses([
    async () => {
      await gate
      return fauxAssistantMessage('first answer')
    },
    fauxAssistantMessage('second answer')
  ])
  const harness = await Harness.open(storage, { models, registry: createRegistry() }, ctx)
  try {
    const root = await harness.createConversation({ ownership: { kind: 'ownerless' } }, ctx)
    await root.configure({ model: { provider: 'faux', modelId: 'faux-1' } }, ctx)
    const thread = runtimeId<'thread'>(String(root.id))
    const legacy = await root.submit(
      {
        type: 'input',
        content: 'first input',
        whenBusy: 'reject',
        entry: { kind: 'cherry.user-input', data: { cherryInputId: 'old-input' } }
      },
      ctx
    )
    expect(await areDurableInputsAbsent(storage, thread, new Set(['lost-input']))).toBe(false)
    finish()
    expect((await legacy.wait(ctx)).status).toBe('done')
    await harness.waitForIdle(ctx)
    expect(await areDurableInputsAbsent(storage, thread, new Set(['lost-input', 'old-input']))).toBe(false)
    expect(await areDurableInputsAbsent(storage, thread, new Set(['lost-input']))).toBe(true)
    const unknown = await root.submit({ type: 'input', content: 'unidentifiable input', whenBusy: 'reject' }, ctx)
    expect((await unknown.wait(ctx)).status).toBe('done')
    await harness.waitForIdle(ctx)
    expect(await areDurableInputsAbsent(storage, thread, new Set(['lost-input']))).toBe(false)
    expect(await areDurableInputsAbsent(storage, runtimeId('99999'), new Set(['lost-input']))).toBe(false)
  } finally {
    finish()
    await harness.close(ctx)
  }
})

it.each(['compaction', 'next-input'] as const)(
  'recovers a committed answer across the correct %s boundary',
  async (between) => {
    const ctx = BACKGROUND_CONTEXT
    const storage = new MemoryStorage()
    const models = createModels()
    const faux = fauxProvider()
    models.setProvider(faux.provider)
    let started!: () => void
    let finish!: () => void
    const generation = new Promise<void>((resolve) => (started = resolve))
    const waiting = new Promise<void>((resolve) => (finish = resolve))
    faux.setResponses([
      async () => {
        started()
        await waiting
        return fauxAssistantMessage('committed answer')
      }
    ])
    const harness = await Harness.open(storage, { models, registry: createRegistry() }, ctx)
    try {
      const root = await harness.createConversation({ ownership: { kind: 'ownerless' } }, ctx)
      await root.configure({ model: { provider: 'faux', modelId: 'faux-1' } }, ctx)
      const inputId = runtimeId<'input'>('request')
      const receipt = await root.submit(
        { type: 'input', content: 'question', requestId: inputId, whenBusy: 'reject' },
        ctx
      )
      await generation
      await harness.commit(async (tx) => {
        const model = [{ role: 'user' as const, content: 'context', timestamp: Date.now() }]
        if (between === 'compaction')
          await tx.appendEntry(CompactionEntry, root.id, { model, data: { reason: 'overflow' } })
        else await tx.appendEntry(UserEntry, root.id, { model })
      }, ctx)
      finish()
      expect((await receipt.wait(ctx)).status).toBe('done')
      const reply = await readDurableReply(storage, { backendId: runtimeId('store'), id: runtimeId(String(root.id)) }, [
        { inputId }
      ])
      if (between === 'compaction')
        expect(reply).toMatchObject({
          messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'committed answer' }] }],
          outcome: { outcome: 'completed' }
        })
      else expect(reply).toBeUndefined()
    } finally {
      finish()
      await harness.close(ctx)
    }
  }
)
