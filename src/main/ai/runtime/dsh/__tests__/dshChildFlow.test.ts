import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

import { DshSubagentCoordinator, type DshSubagentSink } from '../dshChildFlow'

const MAIN = 'main-session'

let seq = 0
const event = (type: string, data: unknown): SessionEvent =>
  ({ type, seq: ++seq, time: Date.now(), data }) as unknown as SessionEvent

const textDelta = (turn: number, index: number, text: string) =>
  event('assistant/chunk', { turn, step: 0, chunk: { type: 'text-delta', index, text } })

const toolCall = (callId: string, name: string, args: Record<string, unknown> = {}) =>
  event('tool/call', { callId, name, arguments: JSON.stringify(args) })

const assistantUsage = (turn: number, usage: Record<string, number>, model = 'deepseek-chat') =>
  event('assistant/message', {
    turn,
    step: 0,
    usage,
    message: { role: 'assistant', content: [], source: { kind: 'assistant', model } }
  })

function spawnAnchor(callId: string, description: string, toolName = 'subagent'): CherryUIMessageChunk {
  return {
    type: 'tool-input-available',
    toolCallId: callId,
    toolName,
    input: { description, prompt: 'go' }
  } as CherryUIMessageChunk
}

function sendAnchor(callId: string, subagentId: string): CherryUIMessageChunk {
  return {
    type: 'tool-input-available',
    toolCallId: callId,
    toolName: 'send_message',
    input: { subagent_id: subagentId, message: 'go on' }
  } as CherryUIMessageChunk
}

function toolError(callId: string): CherryUIMessageChunk {
  return { type: 'tool-output-error', toolCallId: callId, errorText: 'failed' } as CherryUIMessageChunk
}

function makeSink() {
  return {
    currentTurnToken: vi.fn<() => number | null>().mockReturnValue(null),
    emitFlowChunk: vi.fn(),
    emitTaskEvent: vi.fn(),
    emitTasks: vi.fn(),
    emitWorkState: vi.fn(),
    recordChildUsage: vi.fn()
  } satisfies DshSubagentSink
}

const startEdge = (childSessionId: string, runId: string, parentSessionId = MAIN) =>
  ({ phase: 'start', runId, childSessionId, parentSessionId, provider: 'spawn' }) as const

const endEdge = (childSessionId: string, runId: string, stopReason = 'completed', parentSessionId = MAIN) =>
  ({ phase: 'end', runId, childSessionId, parentSessionId, provider: 'spawn', stopReason }) as const

let sink: ReturnType<typeof makeSink>
let coordinator: DshSubagentCoordinator

beforeEach(() => {
  sink = makeSink()
  coordinator = new DshSubagentCoordinator(MAIN, sink)
})

describe('DshSubagentCoordinator binding', () => {
  it('binds the child to its spawning tool call and parents its content chunks', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'research task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleChildEvent('child-1', textDelta(0, 0, 'hello'))

    const chunkCalls = sink.emitFlowChunk.mock.calls
    expect(chunkCalls.every(([root]) => root === 'call-1')).toBe(true)
    const started = chunkCalls.find(([, chunk]) => chunk.type === 'text-start')?.[1]
    expect(started?.providerMetadata).toMatchObject({ cherry: { parentToolCallId: 'call-1' } })
    const delta = chunkCalls.find(([, chunk]) => chunk.type === 'text-delta')?.[1]
    expect(delta).toMatchObject({ delta: 'hello' })
    // Ids are child-scoped so they cannot collide with main-stream blocks.
    expect((started as { id: string }).id).toContain('dsh-c')
  })

  it('buffers child events that race their binding and replays them once bound', () => {
    coordinator.handleChildEvent('child-1', textDelta(0, 0, 'early'))
    expect(sink.emitFlowChunk).not.toHaveBeenCalled()

    coordinator.noteMainChunk(spawnAnchor('call-1', 'task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    const deltas = sink.emitFlowChunk.mock.calls.filter(([, chunk]) => chunk.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0][0]).toBe('call-1')
  })

  it('flattens a grandchild into its ancestor root flow without consuming an anchor', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'parent task'))
    coordinator.noteMainChunk(spawnAnchor('call-2', 'unrelated'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleLifecycle(startEdge('grandchild-1', 'run-2', 'child-1'))
    coordinator.handleChildEvent('grandchild-1', textDelta(0, 0, 'deep'))

    expect(sink.emitFlowChunk.mock.calls.every(([root]) => root === 'call-1')).toBe(true)
    // The second anchor stays queued for the next DIRECT child.
    coordinator.handleLifecycle(startEdge('child-2', 'run-3'))
    coordinator.handleChildEvent('child-2', textDelta(0, 0, 'other'))
    expect(sink.emitFlowChunk.mock.calls.some(([root]) => root === 'call-2')).toBe(true)
  })

  it('reuses the original binding for a later epoch instead of consuming a new anchor', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleLifecycle(endEdge('child-1', 'run-1'))

    // send_message wake: the known child keeps its root card.
    coordinator.noteMainChunk(sendAnchor('call-send', 'child-1'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-2'))
    coordinator.handleChildEvent('child-1', textDelta(1, 0, 'again'))
    expect(sink.emitFlowChunk.mock.calls.every(([root]) => root === 'call-1')).toBe(true)
  })

  it('never leaks a warm send_message anchor onto the next spawned child', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'first task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleLifecycle(endEdge('child-1', 'run-1'))
    coordinator.noteMainChunk(sendAnchor('call-send', 'child-1'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-2'))

    coordinator.noteMainChunk(spawnAnchor('call-2', 'second task'))
    coordinator.handleLifecycle(startEdge('child-2', 'run-3'))
    coordinator.handleChildEvent('child-2', textDelta(0, 0, 'fresh'))
    const roots = sink.emitFlowChunk.mock.calls.map(([root]) => root)
    expect(roots).toContain('call-2')
    expect(roots).not.toContain('call-send')
  })

  it('binds a cold-resumed unknown child to its targeted send_message anchor', () => {
    coordinator.noteMainChunk(sendAnchor('call-send', 'revived-child'))
    coordinator.handleLifecycle(startEdge('revived-child', 'run-9'))
    coordinator.handleChildEvent('revived-child', textDelta(3, 0, 'resumed'))
    const deltas = sink.emitFlowChunk.mock.calls.filter(([, chunk]) => chunk.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0][0]).toBe('call-send')
    expect(sink.emitFlowChunk.mock.calls.every(([root]) => root === 'call-send')).toBe(true)
  })

  it('cold resume matches its targeted anchor instead of stealing an older spawn anchor', () => {
    coordinator.noteMainChunk(spawnAnchor('call-2', 'pending spawn'))
    coordinator.noteMainChunk(sendAnchor('call-send', 'revived-child'))
    coordinator.handleLifecycle(startEdge('revived-child', 'run-9'))
    coordinator.handleChildEvent('revived-child', textDelta(0, 0, 'resumed'))
    const deltas = sink.emitFlowChunk.mock.calls.filter(([, chunk]) => chunk.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0][0]).toBe('call-send')
    expect(sink.emitFlowChunk.mock.calls.every(([root]) => root === 'call-send')).toBe(true)

    coordinator.handleLifecycle(startEdge('child-2', 'run-10'))
    coordinator.handleChildEvent('child-2', textDelta(0, 0, 'spawned'))
    expect(sink.emitFlowChunk.mock.calls.some(([root]) => root === 'call-2')).toBe(true)
  })

  it('drops a failed send_message anchor so a successful retry binds the resumed child', () => {
    coordinator.noteMainChunk(sendAnchor('call-send-failed', 'revived-child'))
    coordinator.noteMainChunk(toolError('call-send-failed'))
    coordinator.noteMainChunk(sendAnchor('call-send-retry', 'revived-child'))
    coordinator.handleLifecycle(startEdge('revived-child', 'run-9'))
    coordinator.handleChildEvent('revived-child', textDelta(0, 0, 'resumed'))

    const deltas = sink.emitFlowChunk.mock.calls.filter(([, chunk]) => chunk.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0][0]).toBe('call-send-retry')
    expect(sink.emitFlowChunk.mock.calls.map(([root]) => root)).not.toContain('call-send-failed')
  })

  it('keeps a pending anchor when an unrelated tool call fails', () => {
    coordinator.noteMainChunk(sendAnchor('call-send', 'revived-child'))
    coordinator.noteMainChunk(toolError('call-other'))
    coordinator.handleLifecycle(startEdge('revived-child', 'run-9'))
    coordinator.handleChildEvent('revived-child', textDelta(0, 0, 'resumed'))
    const deltas = sink.emitFlowChunk.mock.calls.filter(([, chunk]) => chunk.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0][0]).toBe('call-send')
  })

  it('ignores non-anchor tools when queueing anchors', () => {
    coordinator.noteMainChunk({
      type: 'tool-input-available',
      toolCallId: 'call-x',
      toolName: 'read',
      input: { file_path: 'a.txt' }
    } as CherryUIMessageChunk)
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleChildEvent('child-1', textDelta(0, 0, 'x'))
    // No anchor → still buffered, nothing mis-parented under call-x.
    expect(sink.emitFlowChunk).not.toHaveBeenCalled()
  })
})

describe('DshSubagentCoordinator task surface', () => {
  it('publishes task edges and the REPLACE list across an epoch lifecycle', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'research task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))

    expect(sink.emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'started',
        taskId: 'child-1',
        toolUseId: 'call-1',
        status: 'in_progress',
        taskType: 'subagent',
        title: 'research task'
      }),
      'run-1-started'
    )
    expect(sink.emitTasks).toHaveBeenLastCalledWith([
      { id: 'child-1', type: 'subagent', description: 'research task', toolCallId: 'call-1' }
    ])
    expect(sink.emitWorkState).toHaveBeenLastCalledWith(true)

    coordinator.handleLifecycle(endEdge('child-1', 'run-1'))
    expect(sink.emitTaskEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'updated', taskId: 'child-1', status: 'completed' }),
      'run-1-ended'
    )
    expect(sink.emitTasks).toHaveBeenLastCalledWith([])
    expect(sink.emitWorkState).toHaveBeenLastCalledWith(false)
  })

  it.each([
    ['aborted', 'stopped'],
    ['error', 'error'],
    ['max-tokens', 'error'],
    ['refusal', 'error']
  ])('maps stop reason %s to task status %s', (stopReason, status) => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 't'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    coordinator.handleLifecycle(endEdge('child-1', 'run-1', stopReason))
    expect(sink.emitTaskEvent).toHaveBeenLastCalledWith(expect.objectContaining({ status }), 'run-1-ended')
  })

  it('does not publish task rows for nested descendants', () => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 't'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
    sink.emitTaskEvent.mockClear()
    coordinator.handleLifecycle(startEdge('grandchild-1', 'run-2', 'child-1'))
    expect(sink.emitTaskEvent).not.toHaveBeenCalled()
    // But nested epochs still count as live background work.
    coordinator.handleLifecycle(endEdge('child-1', 'run-1'))
    expect(sink.emitWorkState).toHaveBeenLastCalledWith(true)
    coordinator.handleLifecycle(endEdge('grandchild-1', 'run-2', 'completed', 'child-1'))
    expect(sink.emitWorkState).toHaveBeenLastCalledWith(false)
  })
})

describe('DshSubagentCoordinator child projection', () => {
  beforeEach(() => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
  })

  it('maps child tool calls and results with parent metadata', () => {
    coordinator.handleChildEvent('child-1', toolCall('c-tool-1', 'read', { file_path: 'a.txt' }))
    coordinator.handleChildEvent(
      'child-1',
      event('tool/result', {
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c-tool-1', content: [{ type: 'text', text: 'file body' }] }],
          source: { kind: 'tool', callId: 'c-tool-1' }
        }
      })
    )

    const types = sink.emitFlowChunk.mock.calls.map(([, chunk]) => chunk.type)
    expect(types).toEqual(['tool-input-start', 'tool-input-available', 'tool-output-available'])
    const inputAvailable = sink.emitFlowChunk.mock.calls[1][1]
    expect(inputAvailable).toMatchObject({
      toolCallId: 'c-tool-1',
      toolName: 'read',
      input: { file_path: 'a.txt' },
      providerMetadata: { cherry: { parentToolCallId: 'call-1' }, dsh: { childSessionId: 'child-1' } }
    })
  })

  it('maps a failed child tool result to tool-output-error', () => {
    coordinator.handleChildEvent('child-1', toolCall('c-tool-2', 'bash', { command: 'ls' }))
    coordinator.handleChildEvent(
      'child-1',
      event('tool/result', {
        error: 'denied',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c-tool-2',
              isError: true,
              content: [{ type: 'text', text: 'permission denied' }]
            }
          ],
          source: { kind: 'tool', callId: 'c-tool-2' }
        }
      })
    )
    const errorChunk = sink.emitFlowChunk.mock.calls.at(-1)?.[1]
    expect(errorChunk).toMatchObject({ type: 'tool-output-error', errorText: 'permission denied' })
  })

  it('forwards child assistant usage for invocation records', () => {
    coordinator.handleChildEvent('child-1', assistantUsage(2, { inputTokens: 100, outputTokens: 20 }))
    expect(sink.recordChildUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionId: 'child-1',
        turn: 2,
        usage: { inputTokens: 100, outputTokens: 20 },
        model: 'deepseek-chat'
      })
    )
  })
})

// The 2026-08-15 incident class: an item whose opener went to one host stream must
// never emit its later chunks under another turn's identity — an opener-less chunk
// makes the turn persistence accumulator terminate silently and the row goes empty.
describe('DshSubagentCoordinator destination pinning', () => {
  beforeEach(() => {
    coordinator.noteMainChunk(spawnAnchor('call-1', 'task'))
    coordinator.handleLifecycle(startEdge('child-1', 'run-1'))
  })

  it('pins a tool result to the turn its input opened in, not the turn at result time', () => {
    sink.currentTurnToken.mockReturnValue(7)
    coordinator.handleChildEvent('child-1', toolCall('c-tool-1', 'read', { file_path: 'a.txt' }))
    // The parent turn ends before the child's result arrives.
    sink.currentTurnToken.mockReturnValue(null)
    coordinator.handleChildEvent(
      'child-1',
      event('tool/result', {
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c-tool-1', content: [{ type: 'text', text: 'ok' }] }],
          source: { kind: 'tool', callId: 'c-tool-1' }
        }
      })
    )
    const tokens = sink.emitFlowChunk.mock.calls.map(([, chunk, token]) => [chunk.type, token])
    expect(tokens).toEqual([
      ['tool-input-start', 7],
      ['tool-input-available', 7],
      ['tool-output-available', 7]
    ])
  })

  it('pins a between-turns tool call to the detached route even if a new turn opens before the result', () => {
    sink.currentTurnToken.mockReturnValue(null)
    coordinator.handleChildEvent('child-1', toolCall('c-tool-2', 'bash', { command: 'ls' }))
    sink.currentTurnToken.mockReturnValue(8)
    coordinator.handleChildEvent(
      'child-1',
      event('tool/result', {
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c-tool-2', content: [{ type: 'text', text: 'out' }] }],
          source: { kind: 'tool', callId: 'c-tool-2' }
        }
      })
    )
    expect(sink.emitFlowChunk.mock.calls.map(([, chunk, token]) => [chunk.type, token])).toEqual([
      ['tool-input-start', null],
      ['tool-input-available', null],
      ['tool-output-available', null]
    ])
  })

  it('pins text blocks to the turn they opened in across a turn boundary', () => {
    sink.currentTurnToken.mockReturnValue(3)
    coordinator.handleChildEvent('child-1', textDelta(0, 0, 'opened in turn 3'))
    sink.currentTurnToken.mockReturnValue(4)
    coordinator.handleChildEvent('child-1', textDelta(0, 0, ' continued later'))
    coordinator.handleChildEvent(
      'child-1',
      event('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'block-end', index: 0 } })
    )

    const tokens = sink.emitFlowChunk.mock.calls.map(([, chunk, token]) => [chunk.type, token])
    expect(tokens).toEqual([
      ['text-start', 3],
      ['text-delta', 3],
      ['text-delta', 3],
      ['text-end', 3]
    ])
  })

  it('a block opened later pins the newer turn token', () => {
    sink.currentTurnToken.mockReturnValue(3)
    coordinator.handleChildEvent('child-1', textDelta(0, 0, 'step one'))
    sink.currentTurnToken.mockReturnValue(4)
    coordinator.handleChildEvent('child-1', textDelta(0, 1, 'step two'))
    const starts = sink.emitFlowChunk.mock.calls
      .filter(([, chunk]) => chunk.type === 'text-start')
      .map(([, , token]) => token)
    expect(starts).toEqual([3, 4])
  })
})
