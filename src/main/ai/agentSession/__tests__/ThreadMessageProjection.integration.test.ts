import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { configure, createRegistry, defineExtension, defineTool, MemoryStorage } from '@earendil-works/pi-durable'
import { expect, it, onTestFinished } from 'vitest'

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import { runtimeId, type OperationResult, type ThreadHandle } from '@cherrystudio/agent-runtime'
import { createPiRuntime, type PiSessionOptions } from '@cherrystudio/agent-runtime-pi'
import { createPiDurableRuntime } from '@cherrystudio/agent-runtime-pi-durable'
import type { CherryUIMessage } from '@shared/data/types/message'

import {
  assistantReply,
  createTestBinding,
  respondingModel,
  tempDir,
  type TestStream
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { gate, subagentCall } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import { ThreadMessageProjection, type ThreadProjectionUpdate } from '../ThreadMessageProjection'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

const draft = (text: string, whenBusy: 'reject' | 'steer' = 'reject') => ({
  inputId: runtimeId<'input'>(text),
  text,
  whenBusy
})
const answers = (view: ThreadMessageProjection) =>
  view
    .snapshot()
    .messages.filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
const outcome = (view: ThreadMessageProjection, id: string) =>
  view.snapshot().inputs.find((input) => input.inputId === id)?.outcome
const streamed = (updates: ThreadProjectionUpdate[]) =>
  updates.some(
    (update) =>
      update.type === 'change' &&
      update.messages.some((message) =>
        message.parts.some((part) => part.type === 'text' && part.state === 'streaming' && part.text)
      )
  )

async function project(handle: ThreadHandle) {
  const view = new ThreadMessageProjection(handle.thread)
  onTestFinished(() => view.close())
  await view.attach(handle)
  return view
}

async function pi(stream: TestStream) {
  const cwd = tempDir('thread-projection')
  const config: PiSessionOptions = {
    ...(await createTestBinding({ stream })),
    cwd,
    agentDir: cwd,
    sessionManager: SessionManager.inMemory(cwd),
    compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1 },
    behavior: {
      configureChild: () => ({}),
      host: createScriptedHost({
        settings: {
          goalDefaults: { maxGoalRounds: 3, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
          autonomy: 'auto',
          permissionMode: 'auto',
          attendance: 'stream',
          maxBackground: 4,
          offloadThreshold: 20000
        },
        modelKeys: { parentModelKey: 'test/test-model', defaultChildModelKey: 'test/test-model' }
      })
    }
  }
  const errors: unknown[] = []
  const runtime = confirmed(
    await createPiRuntime({
      backendId: runtimeId('pi'),
      load: async () => config,
      onError: (error) => errors.push(error)
    })
  )
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  return { runtime, root: confirmed(await runtime.create(config)), errors }
}

// Parent completion, closing views and releasing handles must not end a background child's stream.
it('projects two Pi background children independently across parent release, selective stop and continuation', async () => {
  const a = gate()
  const b = gate()
  const continuation = gate()
  onTestFinished(() => {
    a.open()
    b.open()
    continuation.open()
  })
  let rootId = ''
  const children = new Map<string, string>()
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) {
      const history = JSON.stringify(call.messages)
      if (history.includes('continue A')) return continuation.wait(assistantReply('child A continued'))
      const name = history.includes('work A') ? 'A' : 'B'
      children.set(name, call.sessionId!)
      return (name === 'A' ? a : b).wait(assistantReply(`child ${name} finished`))
    }
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply(
        [
          subagentCall('spawn-a', { description: 'first child', prompt: 'work A', background: true }),
          subagentCall('spawn-b', { description: 'second child', prompt: 'work B', background: true })
        ],
        'toolUse'
      )
    return assistantReply('parent finished')
  }, 1)
  const { runtime, root, errors } = await pi(provider.model)
  rootId = root.thread.id
  const parent = await project(root)
  await root.input.submit(draft('delegate'))
  await Promise.all([a.reached, b.reached])
  await expect.poll(() => outcome(parent, 'delegate')).toBe('completed')
  expect(parent.snapshot().subagents).toHaveLength(2)
  const openChild = async (name: string) => {
    const ref = parent.snapshot().subagents.find((relation) => relation.child?.id === children.get(name))?.child
    if (!ref) throw new Error(`Missing child ${name}`)
    return confirmed(await runtime.open(ref))
  }
  const childA = await openChild('A')
  const childB = await openChild('B')
  const viewA = await project(childA)
  const viewB = await project(childB)
  const panel: ThreadProjectionUpdate[] = []
  const card: ThreadProjectionUpdate[] = []
  const stopCard = viewA.subscribe((update) => card.push(update))
  viewA.subscribe((update) => panel.push(update))
  stopCard()
  await root.release()
  await parent.close()
  const savedParent = parent.snapshot()
  a.open()
  await expect.poll(() => answers(viewA)).toEqual(['child A finished'])
  await expect.poll(() => viewA.snapshot().activity.state).toBe('idle')
  expect(streamed(panel)).toBe(true)
  expect(card).toHaveLength(1)
  expect(answers(viewB)).not.toContain('child A finished')
  expect(viewB.snapshot().activity.state).toBe('active')
  confirmed(await childB.interrupt!())
  await expect.poll(() => viewB.snapshot().activity.state).toBe('idle')
  expect(answers(viewB)).not.toContain('child B finished')
  expect(parent.snapshot()).toBe(savedParent)
  expect(answers(parent)).toEqual(['parent finished'])

  expect(await childA.input.submit(draft('continue A', 'steer'))).toMatchObject({ status: 'acknowledged' })
  await continuation.reached
  const secondAccess = confirmed(await runtime.open(childA.thread))
  await viewA.attach(secondAccess)
  await childA.release()
  continuation.open()
  await expect.poll(() => outcome(viewA, 'continue A')).toBe('completed')
  expect(answers(viewA)).toEqual(['child A finished', 'child A continued'])
  expect(new Set(viewA.snapshot().messages.map((message) => message.id)).size).toBe(viewA.snapshot().messages.length)
  expect(parent.snapshot()).toBe(savedParent)
  expect(errors).toEqual([])
})

// A foreground child stop owns its waiting parent turn, but not a later parent turn.
it('shows Pi foreground cancellation in the parent and leaves its next turn isolated from the child', async () => {
  const held = gate()
  onTestFinished(() => held.open())
  let rootId = ''
  const provider = respondingModel((call) => {
    if (call.sessionId !== rootId) return held.wait(assistantReply('cancelled child answer'))
    if (JSON.stringify(call.messages.at(-1)).includes('delegate'))
      return assistantReply([subagentCall('spawn', { description: 'foreground child', prompt: 'work' })], 'toolUse')
    return assistantReply('next parent answer')
  }, 1)
  const { runtime, root, errors } = await pi(provider.model)
  rootId = root.thread.id
  const parent = await project(root)
  await root.input.submit(draft('delegate'))
  await held.reached
  await expect.poll(() => parent.snapshot().subagents.length).toBe(1)
  const child = confirmed(await runtime.open(parent.snapshot().subagents[0].child!))
  const view = await project(child)
  confirmed(await child.interrupt!())
  await expect.poll(() => outcome(parent, 'delegate')).toBe('aborted')
  await root.input.submit(draft('next'))
  confirmed(await child.interrupt!())
  await expect.poll(() => outcome(parent, 'next')).toBe('completed')
  expect(answers(parent)).toContain('next parent answer')
  expect(answers(view)).not.toContain('cancelled child answer')
  expect(answers(view)).not.toContain('next parent answer')
  expect(errors).toEqual([])
})

// Durable repeatedly replaces current-view snapshots; previews must become one saved answer per thread.
it('projects a Durable parent, child and grandchild, then continues only the child after reattachment', async () => {
  const leaf = gate()
  const continuation = gate()
  onTestFinished(() => {
    leaf.open()
    continuation.open()
  })
  const faux = fauxProvider({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } })
  const models = createModels()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  const delegate = defineTool({
    name: 'delegate',
    description: 'Create a native child conversation',
    parameters: Type.Object({ depth: Type.Number() }),
    async execute({ depth }, api, context) {
      const child = await api.commit(async (tx) => {
        const record = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } })
        await configure(tx, record.id, {
          model: { provider: 'faux', modelId: 'faux-1' },
          tools: depth > 1 ? [delegate] : []
        })
        return record
      }, context)
      const conversation = await api.conversation(child.id, context)
      await (await conversation!.submit({ type: 'input', content: 'child task' }, context)).wait(context)
      return { output: [{ type: 'text', text: 'child completed' }] }
    }
  })
  registry.install(defineExtension({ name: 'delegate', tools: [delegate] }))
  const errors: unknown[] = []
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('durable'),
      openStorage: async () => new MemoryStorage(),
      harness: { models, registry, onReport: (error) => errors.push(error) },
      onError: (error) => errors.push(error)
    })
  )
  onTestFinished(async () => {
    leaf.open()
    continuation.open()
    await runtime.shutdown()
  })
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('delegate', { depth: 2 }, { id: 'root-spawn' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('delegate', { depth: 1 }, { id: 'child-spawn' }), { stopReason: 'toolUse' }),
    () => leaf.wait(fauxAssistantMessage('grandchild answer')),
    fauxAssistantMessage('child answer'),
    fauxAssistantMessage('parent answer')
  ])
  const root = confirmed(
    await runtime.create({
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
  )
  const parent = await project(root)
  await root.input.submit(draft('delegate'))
  await expect.poll(() => parent.snapshot().subagents.length).toBe(1)
  const child = confirmed(await runtime.open(parent.snapshot().subagents[0].child!))
  const childView = await project(child)
  await expect.poll(() => childView.snapshot().subagents.length).toBe(1)
  const grandchild = confirmed(await runtime.open(childView.snapshot().subagents[0].child!))
  const grandchildView = await project(grandchild)
  const updates: ThreadProjectionUpdate[] = []
  grandchildView.subscribe((update) => updates.push(update))
  await leaf.reached
  leaf.open()
  await expect.poll(() => outcome(parent, 'delegate'), { timeout: 5000 }).toBe('completed')
  expect(answers(parent)).toEqual(['parent answer'])
  expect(answers(childView)).toEqual(['child answer'])
  expect(answers(grandchildView)).toEqual(['grandchild answer'])
  expect(streamed(updates)).toBe(true)
  for (const view of [parent, childView, grandchildView])
    expect(view.snapshot().subagents.every((relation) => relation.parent.id === view.thread.id)).toBe(true)

  await root.release()
  await parent.close()
  const parentBefore = parent.snapshot()
  const grandchildBefore = grandchildView.snapshot()
  const firstChildMessages: readonly CherryUIMessage[] = childView.snapshot().messages
  faux.setResponses([
    () => continuation.wait(fauxAssistantMessage('child interim')),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain('extra detail')
      return fauxAssistantMessage('child continued')
    }
  ])
  await child.input.submit(draft('continue child'))
  await continuation.reached
  expect(await child.input.submit(draft('busy'))).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
  expect(await child.input.submit(draft('extra detail', 'steer'))).toMatchObject({ status: 'acknowledged' })
  const access = confirmed(await runtime.open(child.thread))
  await childView.attach(access)
  await child.release()
  continuation.open()
  await expect.poll(() => outcome(childView, 'extra detail'), { timeout: 5000 }).toBe('completed')
  expect(answers(childView)).toEqual(['child answer', 'child interim', 'child continued'])
  for (const old of firstChildMessages)
    expect(childView.snapshot().messages.find((message) => message.id === old.id)).toBe(old)
  expect(parent.snapshot()).toBe(parentBefore)
  expect(grandchildView.snapshot()).toBe(grandchildBefore)
  expect(childView.snapshot().inputs.some((input) => input.inputId === 'busy')).toBe(false)
  expect(errors).toEqual([
    expect.objectContaining({ name: 'ConversationBusy', conversationId: Number(child.thread.id) })
  ])
})
