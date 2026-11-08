import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MessageProjectionUpdate, MessageProjectionView, ProjectionTarget } from '@shared/ai/messageProjection'

import { MessageProjectionService } from '../MessageProjectionService'
import { toolResultService } from '../ToolResultService'

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
afterEach(() => vi.restoreAllMocks())
const target: ProjectionTarget = { kind: 'topic', topicId: 'root' }
const base: MessageProjectionView = {
  ...target,
  revision: 0,
  executions: [],
  messages: [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: 'A' }] }]
}
const append = (revision: number, text: string): MessageProjectionUpdate => ({
  ...target,
  executions: [],
  revision,
  patches: [{ type: 'append', messageId: 'm', part: 0, text }],
  order: ['m']
})

// These races used to lose content or apply it twice at attach/replay boundaries.
describe('shared projection delivery', () => {
  it('installs a baseline before uncovered live updates and ignores duplicates', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off = store.subscribe(target, () => {})
    const first = ipc.attachments[0]
    ipc.emit(first.subscriptionId, append(1, 'B'))
    first.resolve(base)
    await flush()
    expect(store.getSnapshot(target).view?.messages[0].parts[0]).toMatchObject({ text: 'AB' })
    const stable = store.getSnapshot(target)
    ipc.emit(first.subscriptionId, append(1, 'B'))
    expect(store.getSnapshot(target)).toBe(stable)
    off()
  })

  it('recovers a gap in a fresh revision domain and rejects the old subscription', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off = store.subscribe(target, () => {})
    ipc.attachments[0].resolve(base)
    await flush()
    const old = ipc.attachments[0].subscriptionId
    ipc.emit(old, append(3, 'invalid suffix'))
    expect(ipc.attachments[1].subscriptionId).not.toBe(old)
    ipc.emit(old, append(1, 'stale'))
    ipc.attachments[1].resolve({
      ...base,
      revision: 3,
      messages: [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: 'recovered' }] }]
    })
    await flush()
    expect(store.getSnapshot(target).view?.messages[0].parts[0]).toMatchObject({ text: 'recovered' })
    off()
  })

  it('bounds attach buffering and replaces the baseline after overflow', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off = store.subscribe(target, () => {})
    for (let i = 1; i <= 101; i++) ipc.emit(ipc.attachments[0].subscriptionId, append(i, 'x'))
    ipc.attachments[0].resolve(base)
    await flush()
    ipc.attachments[1].resolve({
      ...base,
      revision: 101,
      messages: [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: 'complete' }] }]
    })
    await flush()
    expect(store.getSnapshot(target).view?.messages[0].parts[0]).toMatchObject({ text: 'complete' })
    off()
  })

  it('shares delivery leases, leaves native work alone, and fences late attach results', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off1 = store.subscribe(target, () => {})
    const off2 = store.subscribe(target, () => {})
    expect(ipc.attachments).toHaveLength(1)
    off1()
    expect(ipc.detached).toEqual([])
    off2()
    const off3 = store.subscribe(target, () => {})
    ipc.attachments[0].resolve(base)
    await flush()
    expect(store.getSnapshot(target).view).toBeNull()
    ipc.attachments[1].resolve({ ...base, messages: [] })
    await flush()
    expect(store.getSnapshot(target).view?.messages).toEqual([])
    off3()
    expect(ipc.request.mock.calls.map(([route]) => route)).not.toContain('ai.stream.abort')
  })
})

// A child lookup belongs to its parent, but detail storage belongs to the child's separate archive.
it('invalidates and releases the installed child archive without clearing its parent or another child observer', async () => {
  const ipc = projectionIpc()
  const projectionRequest = ipc.request.getMockImplementation()
  if (!projectionRequest) throw new Error('Projection bridge is unavailable')
  let output = 'A'
  ipc.request.mockImplementation(async (route, input) =>
    route === 'ai.tool.get_result'
      ? { ok: true, data: { status: 'ready', purpose: 'preview', output, truncated: false } }
      : projectionRequest(route, input)
  )
  const childTarget: ProjectionTarget = { kind: 'child', sessionId: 'parent', toolCallId: 'spawn' }
  const childBase: MessageProjectionView = {
    kind: 'child',
    sessionId: 'child-archive',
    contextId: 'child-context',
    active: false,
    available: true,
    canSubmit: false,
    revision: 0,
    messages: []
  }
  const childRef = { topicId: 'agent-session:child-archive', messageId: 'message', toolCallId: 'tool' }
  const parentRef = { ...childRef, topicId: 'agent-session:parent' }
  const parentRelease = toolResultService.retainTopic(parentRef.topicId)
  const store = new MessageProjectionService()
  const first = store.subscribe(childTarget, () => {})
  const second = store.subscribe(childTarget, () => {})
  ipc.attachments[0].resolve(childBase)
  await flush()
  await toolResultService.read(childRef)
  await toolResultService.read(parentRef)
  first()
  expect(toolResultService.getSnapshot(childRef)).toMatchObject({ status: 'ready', output: 'A' })
  ipc.emit(ipc.attachments[0].subscriptionId, { ...childBase, revision: 3, patches: [] })
  expect(toolResultService.getSnapshot(childRef)).toEqual({ status: 'idle' })
  expect(toolResultService.getSnapshot(parentRef)).toMatchObject({ status: 'ready', output: 'A' })
  output = 'B'
  ipc.attachments[1].resolve({ ...childBase, revision: 3 })
  await flush()
  await toolResultService.read(childRef)
  MockDataApiUtils.emitDataChange([
    { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', routeParams: { sessionId: 'child-archive' } }
  ])
  expect(toolResultService.getSnapshot(childRef)).toEqual({ status: 'idle' })
  await toolResultService.read(childRef)
  expect(toolResultService.getSnapshot(childRef)).toMatchObject({ status: 'ready', output: 'B' })
  ipc.emit(ipc.attachments[1].subscriptionId, { ...childBase, revision: 6, patches: [] })
  ipc.attachments[2].resolve({ ...childBase, sessionId: 'replacement-child', revision: 6 })
  await flush()
  const replacementRef = { ...childRef, topicId: 'agent-session:replacement-child' }
  await toolResultService.read(replacementRef)
  expect(toolResultService.getSnapshot(childRef)).toEqual({ status: 'idle' })
  expect(toolResultService.getSnapshot(replacementRef)).toMatchObject({ status: 'ready', output: 'B' })
  second()
  expect(toolResultService.getSnapshot(replacementRef)).toEqual({ status: 'idle' })
  expect(toolResultService.getSnapshot(childRef)).toEqual({ status: 'idle' })
  expect(toolResultService.getSnapshot(parentRef)).toMatchObject({ status: 'ready', output: 'A' })
  parentRelease()
})
