import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from '@earendil-works/pi-ai'
import { createRegistry, defineExtension, defineTool, Harness, LiveDoc } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it } from 'vitest'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// A generation-task ID changes after tools; submissions must retain the consuming run across that handover.
it('binds steers at consumption, retains run usage identity, and reopens without replaying work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-runs-'))
  const path = join(directory, 'store.sqlite')
  const reached = gate()
  const release = gate()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  registry.install(
    defineExtension({
      name: 'hold',
      tools: [
        defineTool({
          name: 'hold',
          description: 'Wait',
          parameters: Type.Object({}),
          replay: 'safe',
          async execute() {
            reached.resolve()
            await release.promise
            return { output: [{ type: 'text', text: 'ready' }] }
          }
        })
      ]
    })
  )
  const options = { models, registry }
  let harness = await Harness.open(await openNodeSqliteStorage(path), options, context)
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: {
          model: { provider: 'faux', modelId: 'faux-1' }
        }
      },
      context
    )
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('hold', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('first answer'),
      fauxAssistantMessage('next answer')
    ])
    const first = await conversation.submit({ type: 'input', content: 'start' }, context)
    await reached.promise
    const start = await first.status(context)
    expect(start.type === 'input' && start.runId).toEqual(
      (await harness.snapshot(LiveDoc, conversation.id, context))!.run!.id
    )
    const steer = await conversation.submit({ type: 'input', content: 'correction', whenBusy: 'steer' }, context)
    expect(await steer.status(context)).not.toHaveProperty('runId')
    release.resolve()
    await first.wait(context)
    const end = await steer.wait(context)
    expect(end).toMatchObject({ status: 'done', runId: start.type === 'input' ? start.runId : undefined })
    const late = await conversation.submit({ type: 'input', content: 'late correction', whenBusy: 'steer' }, context)
    const later = await late.wait(context)
    expect(later.type === 'input' && later.runId).not.toEqual(start.type === 'input' && start.runId)
    const entries = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items
    expect(entries.filter((entry) => entry.kind === 'pi.assistant').map((entry) => entry.data)).toEqual([
      { runId: start.type === 'input' && start.runId },
      { runId: start.type === 'input' && start.runId },
      { runId: later.type === 'input' && later.runId }
    ])
    await harness.close(context)
    harness = await Harness.open(await openNodeSqliteStorage(path), options, context)
    expect(await (await harness.submission(steer.id, context))!.status(context)).toEqual(end)
    expect(await (await harness.submission(late.id, context))!.status(context)).toEqual(later)
    expect(faux.state.callCount).toBe(3)
  } finally {
    release.resolve()
    await harness.close(context)
    await rm(directory, { recursive: true, force: true })
  }
})

it('retains the consuming run when a request fails before producing an assistant entry', async () => {
  const { MemoryStorage } = await import('@earendil-works/pi-durable')
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context
  )
  try {
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context)
    const input = await conversation.submit({ type: 'input', content: 'no model' }, context)
    const result = await input.wait(context)
    expect(result).toMatchObject({ status: 'unanswered', reason: 'no_model', runId: expect.any(Number) })
    expect(
      (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items.filter(
        (entry) => entry.kind === 'pi.assistant'
      )
    ).toEqual([])
  } finally {
    await harness.close(context)
  }
})
