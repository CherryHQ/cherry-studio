import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  LivePartPatch,
  ChildPartPlacement,
  TimelinePlacement,
  MessageProjectionUpdate,
  MessageProjectionView,
  ProjectionTarget
} from '@shared/ai/messageProjection'

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
  it.each([
    [20, 20],
    [20_000, 20],
    [20, 20_000]
  ])(
    'delivers text only to the affected part with %i older messages and %i settled siblings',
    async (count, siblings) => {
      const ipc = projectionIpc()
      const store = new MessageProjectionService()
      const structure = vi.fn()
      const text = vi.fn()
      const off = store.subscribe(target, structure, text)
      const first = ipc.attachments[0]
      const earlier = { type: 'text' as const, text: 'Earlier' }
      const active = { type: 'text' as const, text: 'A', state: 'streaming' as const }
      let reads = 0
      let siblingReads = 0
      const settled = Array.from({ length: siblings }, () => earlier)
      const parts = new Proxy([...settled, active], {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) < siblings) siblingReads++
          return Reflect.get(target, key, receiver)
        }
      })
      const history = Array.from({ length: count }, (_, index) => ({
        ...base.messages[0],
        id: `history-${index}`,
        partIds: [`history-part-${index}`],
        get parts() {
          reads++
          return [earlier]
        }
      }))
      first.resolve({
        ...base,
        messages: [
          ...history,
          {
            ...base.messages[0],
            partIds: [...settled.map((_, index) => `sibling-${index}`), 'active'],
            parts
          }
        ]
      })
      await flush()
      const partsReader = store.partsFor(target)
      const leaf = vi.fn(() => partsReader.read('active'))
      const offPart = partsReader.subscribe('active', leaf)
      const baseline = store.getSnapshot(target)
      reads = 0
      siblingReads = 0
      structure.mockClear()
      ipc.emit(first.subscriptionId, {
        kind: 'topic',
        type: 'parts',
        revision: 1,
        patches: [{ type: 'part-append', partId: 'active', text: 'B' }]
      })
      expect(leaf.mock.results.map(({ value }) => value)).toMatchObject([{ text: 'AB' }])
      expect(text.mock.calls).toEqual([
        [{ type: 'text-append', messageId: 'm', partId: 'active', offset: 1, text: 'B', turnOrigin: undefined }]
      ])
      expect(structure).not.toHaveBeenCalled()
      expect(store.getSnapshot(target)).toBe(baseline)
      expect(reads).toBe(0)
      expect(siblingReads).toBe(0)
      expect(store.readParts([earlier, active])).toEqual([earlier, { ...active, text: 'AB' }])
      offPart()
      off()
    }
  )

  it('appends a compaction mark and a new block to the root while an earlier block continues growing', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off = store.subscribe(target, () => {})
    const attachment = ipc.attachments[0]
    const initial = {
      ...base.messages[0],
      partIds: ['a'],
      parts: [{ type: 'text', text: 'A', state: 'streaming' }]
    } as const
    attachment.resolve({ ...base, messages: [{ ...initial, partIds: ['a'], parts: [...initial.parts] }] })
    await flush()
    ipc.emit(attachment.subscriptionId, {
      type: 'parts',
      kind: 'topic',
      revision: 1,
      patches: [
        {
          type: 'part-add',
          partId: 'c',
          placement: { messageId: 'm', pos: 12 },
          part: { type: 'data-compaction-anchor', data: { phase: 'agent-session', status: 'done' } }
        },
        { type: 'part-open', partId: 'b', messageId: 'm', pos: 13, kind: 'text' },
        { type: 'part-append', partId: 'b', text: 'B' },
        { type: 'part-append', partId: 'a', text: '1' }
      ]
    })
    expect(store.readMessage(target, base.messages[0])).toMatchObject({
      partIds: ['a', 'c', 'b'],
      parts: [{ text: 'A1' }, { type: 'data-compaction-anchor' }, { text: 'B' }]
    })
    off()
  })

  it('commits linked insertions once and rolls back a cross-row anchor at the end of a batch', async () => {
    const target = { kind: 'child', sessionId: 's', toolCallId: 'call' } as const
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const shell = vi.fn()
    const off = store.subscribe(target, shell)
    const attachment = ipc.attachments[0]
    attachment.resolve({
      ...target,
      active: true,
      available: true,
      canSubmit: true,
      contextId: 'c',
      revision: 0,
      messages: [
        { ...base.messages[0], partIds: ['first'] },
        { ...base.messages[0], id: 'another', partIds: ['elsewhere'] }
      ]
    })
    await flush()
    const publish = (revision: number, patches: LivePartPatch<ChildPartPlacement>[]) =>
      ipc.emit(attachment.subscriptionId, { type: 'parts', kind: 'child', revision, patches })
    const row = store.partsFor(target).row('m')!
    const snapshots: string[][] = []
    const stopLayout = row.subscribe(() => snapshots.push([...store.readMessage(target, base.messages[0]).partIds!]))
    const observed: unknown[] = []
    const stop = store.watchPart(target, 'reason', () => observed.push(store.readPart(target, 'reason')))
    publish(1, [
      { type: 'part-open', kind: 'reasoning', partId: 'reason', messageId: 'm', afterPartId: 'first' },
      { type: 'part-append', partId: 'reason', text: 'why' },
      { type: 'part-open', kind: 'text', partId: 'answer', messageId: 'm', afterPartId: 'reason' },
      { type: 'part-finish', partId: 'reason' }
    ])
    expect(snapshots).toEqual([['first', 'reason', 'answer']])
    expect(shell).toHaveBeenCalledTimes(1)
    expect(observed).toEqual([{ type: 'reasoning', text: 'why', state: 'done' }])
    publish(2, [
      { type: 'part-append', partId: 'answer', text: 'unpublished' },
      { type: 'part-open', kind: 'text', partId: 'invalid', messageId: 'm', afterPartId: 'elsewhere' }
    ])
    expect(store.readPart(target, 'answer')).toMatchObject({ text: '' })
    expect(store.readPart(target, 'invalid')).toBeUndefined()
    expect(snapshots).toHaveLength(1)
    stopLayout()
    expect(ipc.attachments).toHaveLength(2)
    stop()
    off()
  })

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

  it('inserts and completes a text block by part ID and notifies only its subscribers for a suffix', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const structural = vi.fn()
    const off = store.subscribe(target, structural)
    const first = ipc.attachments[0]
    first.resolve({ ...base, messages: [{ ...base.messages[0], partIds: ['previous'] }] })
    await flush()
    const publish = (revision: number, patch: LivePartPatch<TimelinePlacement>) =>
      ipc.emit(first.subscriptionId, { kind: 'topic', type: 'parts', revision, patches: [patch] })
    publish(1, { type: 'part-open', messageId: 'm', partId: 'new', pos: 2, kind: 'text' })
    const shell = store.getSnapshot(target).view!.messages[0]
    const open = store.readMessage(target, shell)
    expect(open.partIds).toEqual(['previous', 'new'])
    expect(open.parts[1]).toEqual({ type: 'text', text: '', state: 'streaming' })
    const partsReader = store.partsFor(target)
    const changed = vi.fn(() => partsReader.read('new'))
    const offPart = partsReader.subscribe('new', changed)
    structural.mockClear()
    publish(2, { type: 'part-append', partId: 'new', text: 'B' })
    expect(changed.mock.results[0]?.value).toMatchObject({ text: 'B' })
    expect(structural).not.toHaveBeenCalled()
    publish(3, { type: 'part-finish', partId: 'new' })
    expect(store.readPart(target, 'new')).toEqual({ type: 'text', text: 'B', state: 'done' })
    expect(store.getSnapshot(target).view?.messages[0]).toBe(shell)
    expect(store.readParts(shell.parts)).toEqual([shell.parts[0], { type: 'text', text: 'B', state: 'done' }])
    expect(structural).not.toHaveBeenCalled()
    offPart()
    off()
  })

  it('applies terminal truncation and appended output to the addressed tool without replacing its row', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const off = store.subscribe(target, () => {})
    const first = ipc.attachments[0]
    const tool = {
      type: 'dynamic-tool',
      toolName: 'ACP: Shell',
      toolCallId: 'shell',
      state: 'input-available',
      input: { localAcpTool: { terminals: { log: '🌸abc' }, terminalDetails: { log: { truncated: false } } } }
    } as const
    first.resolve({ ...base, messages: [{ ...base.messages[0], parts: [tool], partIds: ['part'] }] })
    await flush()
    const row = store.partsFor(target).row('m')!
    const before = row.getSnapshot()
    const send = (revision: number) =>
      ipc.emit(first.subscriptionId, {
        kind: 'topic',
        type: 'parts',
        revision,
        patches: [
          {
            type: 'part-tool-terminal',
            partId: 'part',
            delta: { toolCallId: 'shell', terminalId: 'log', drop: 2, append: '新', truncated: true }
          }
        ]
      })
    send(1)
    send(1)
    expect(store.readPart(target, 'part')).toMatchObject({
      input: { localAcpTool: { terminals: { log: 'abc新' }, terminalDetails: { log: { truncated: true } } } }
    })
    expect(tool.input.localAcpTool.terminals.log).toBe('🌸abc')
    expect(row.getSnapshot()).toBe(before)
    off()
  })

  it('delivers running tool output to its row and settles its status in the view', async () => {
    const ipc = projectionIpc()
    const store = new MessageProjectionService()
    const structure = vi.fn()
    const off = store.subscribe(target, structure)
    const first = ipc.attachments[0]
    const tool = {
      type: 'dynamic-tool',
      toolName: 'shell',
      toolCallId: 'call',
      state: 'input-available',
      input: {}
    } as const
    first.resolve({ ...base, messages: [{ ...base.messages[0], parts: [tool], partIds: ['call-part'] }] })
    await flush()
    structure.mockClear()
    const leaf = vi.fn(() => store.getPart(tool))
    const offPart = store.partsFor(target).subscribe('call-part', leaf)
    const layout = store.partsFor(target).row(base.messages[0].id)!
    const initialLayout = layout.getSnapshot()
    const running = { ...tool, state: 'output-available' as const, output: 'working', preliminary: true }
    ipc.emit(first.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 1,
      patches: [{ type: 'part-put', partId: 'call-part', part: running }]
    })
    expect(leaf.mock.results.map(({ value }) => value)).toEqual([running])
    expect(structure).not.toHaveBeenCalled()
    const runningLayout = layout.getSnapshot()
    expect(runningLayout).not.toBe(initialLayout)
    ipc.emit(first.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 2,
      patches: [{ type: 'part-put', partId: 'call-part', part: { ...running, output: 'more progress' } }]
    })
    expect(layout.getSnapshot()).toBe(runningLayout)
    const final = { ...running, output: 'done', preliminary: false }
    ipc.emit(first.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 3,
      patches: [{ type: 'part-put', partId: 'call-part', part: final }]
    })
    expect(store.readParts(store.getSnapshot(target).view!.messages[0].parts)).toEqual([final])
    expect(structure).not.toHaveBeenCalled()
    offPart()
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
  const earlier = { ...childRef, messageId: 'earlier' }
  await toolResultService.read(earlier)
  MockDataApiUtils.emitDataChange([
    {
      endpoint: '/agent-sessions/:sessionId/messages',
      kind: 'projection',
      routeParams: { sessionId: 'child-archive' },
      entityIds: [childRef.messageId]
    }
  ])
  expect(toolResultService.getSnapshot(earlier)).toMatchObject({ status: 'ready', output: 'B' })
  expect(toolResultService.getSnapshot(childRef)).toEqual({ status: 'idle' })
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
