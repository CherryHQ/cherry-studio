import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { areDurableInputsAbsent } from '../src/replyHistory'

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
