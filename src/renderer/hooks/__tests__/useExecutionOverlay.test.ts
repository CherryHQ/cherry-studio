import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExecutionTerminal } from '../../transport/TopicStreamSubscription'

// ── Controllable fake TopicStreamSubscription ───────────────────────────
const { fake } = vi.hoisted(() => {
  type Branch = { stream: ReadableStream<unknown>; controller: ReadableStreamDefaultController<unknown> }
  const branches = new Map<string, Branch>()
  const terminalCbs = new Set<(id: string, t: ExecutionTerminal) => void>()
  const api = {
    branches,
    terminalCbs,
    register(executionId: string) {
      let b = branches.get(executionId)
      if (!b) {
        let controller!: ReadableStreamDefaultController<unknown>
        const stream = new ReadableStream<unknown>({ start: (c) => (controller = c) })
        b = { stream, controller }
        branches.set(executionId, b)
      }
      return b.stream
    },
    unregister(executionId: string) {
      const b = branches.get(executionId)
      try {
        b?.controller.close()
      } catch {
        /* already closed */
      }
      branches.delete(executionId)
    },
    onExecutionTerminal(cb: (id: string, t: ExecutionTerminal) => void) {
      terminalCbs.add(cb)
      return () => terminalCbs.delete(cb)
    },
    // test helpers
    emit(executionId: string, chunk: CherryUIMessageChunk) {
      branches.get(executionId)?.controller.enqueue(chunk)
    },
    close(executionId: string) {
      try {
        branches.get(executionId)?.controller.close()
      } catch {
        /* noop */
      }
    },
    terminal(executionId: string, t: ExecutionTerminal) {
      for (const cb of terminalCbs) cb(executionId, t)
      api.close(executionId)
    },
    reset() {
      branches.clear()
      terminalCbs.clear()
    }
  }
  return { fake: api }
})

vi.mock('../useTopicStreamSubscription', () => ({
  useTopicStreamSubscription: () => fake
}))

import { useExecutionOverlay } from '../useExecutionOverlay'

const TOPIC = 'topic-1'
const A = 'openai::gpt-4o' as UniqueModelId
const B = 'anthropic::claude' as UniqueModelId

const exec = (executionId: UniqueModelId, anchorMessageId?: string): ActiveExecution => ({
  executionId,
  anchorMessageId
})
const asst = (id: string, parts: CherryUIMessage['parts'] = []): CherryUIMessage =>
  ({ id, role: 'assistant', parts }) as CherryUIMessage

function streamText(executionId: string, textId: string, text: string, opts?: { startId?: string }) {
  if (opts?.startId) fake.emit(executionId, { type: 'start', messageId: opts.startId } as CherryUIMessageChunk)
  fake.emit(executionId, { type: 'text-start', id: textId } as CherryUIMessageChunk)
  fake.emit(executionId, { type: 'text-delta', id: textId, delta: text } as CherryUIMessageChunk)
  fake.emit(executionId, { type: 'text-end', id: textId } as CherryUIMessageChunk)
  fake.emit(executionId, { type: 'finish' } as CherryUIMessageChunk)
}

function textOf(parts: CherryUIMessage['parts'] | undefined): string {
  return (parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

beforeEach(() => fake.reset())
afterEach(() => {
  fake.reset()
  vi.clearAllMocks()
})

describe('useExecutionOverlay', () => {
  it('N1 — anchored overlay isolation: each execution lands only on its own anchor', async () => {
    const ui = [asst('anchor-a'), asst('anchor-b')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], ui))

    streamText(A, 'tA', 'helloA')
    streamText(B, 'tB', 'helloB')

    await waitFor(() => {
      expect(textOf(result.current.overlay['anchor-a'])).toBe('helloA')
      expect(textOf(result.current.overlay['anchor-b'])).toBe('helloB')
    })
    expect(textOf(result.current.overlay['anchor-a'])).not.toContain('helloB')
  })

  it('N2 — no cross-turn pollution: same model, new anchor next turn is clean', async () => {
    const ui1 = [asst('anchor-1')]
    const { result, rerender } = renderHook(
      ({ execs, ui }: { execs: ActiveExecution[]; ui: CherryUIMessage[] }) => useExecutionOverlay(TOPIC, execs, ui),
      { initialProps: { execs: [exec(A, 'anchor-1')], ui: ui1 } }
    )

    streamText(A, 't1', 'round-1')
    await waitFor(() => expect(textOf(result.current.overlay['anchor-1'])).toBe('round-1'))
    fake.terminal(A, { isAbort: false, isError: false })

    // Turn 1 done → execution leaves activeExecutions.
    rerender({ execs: [], ui: ui1 })
    // Turn 2 for the SAME model, a fresh placeholder anchor.
    const ui2 = [asst('anchor-1', [{ type: 'text', text: 'round-1' }]), asst('anchor-2')]
    rerender({ execs: [exec(A, 'anchor-2')], ui: ui2 })

    streamText(A, 't2', 'round-2')
    await waitFor(() => expect(textOf(result.current.overlay['anchor-2'])).toBe('round-2'))
    // No "round-1 + round-2" on the new anchor; old anchor not re-streamed.
    expect(textOf(result.current.overlay['anchor-2'])).toBe('round-2')
    expect(result.current.overlay['anchor-1']).toBeUndefined()
  })

  it('N3 — continue/tool seed: reader seeded from current DB anchor keeps prior parts', async () => {
    // Tool-approval/continue: the anchor row already carries prior assistant
    // parts. Seeding from the current DB anchor (not empty) means a streamed
    // continuation appends after the existing content instead of replacing it.
    const ui = [asst('anchor-a', [{ type: 'text', text: 'PRIOR ' }])]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))

    streamText(A, 't2', 'CONTINUED')
    await waitFor(() => {
      const t = textOf(result.current.overlay['anchor-a'])
      expect(t).toContain('PRIOR')
      expect(t).toContain('CONTINUED')
    })
  })

  it('N3b — leaves the SWR-cached seed row unmutated during streaming (REGRESSION renderer-transport-1)', async () => {
    // The anchor row is the live SWR-derived projection; readUIMessageStream mutates its
    // message.parts in place. The seed must be cloned so the cached row is never touched.
    const priorParts: CherryUIMessage['parts'] = [{ type: 'text', text: 'PRIOR ' }]
    const ui = [asst('anchor-a', priorParts)]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))

    streamText(A, 't2', 'CONTINUED')
    await waitFor(() => expect(textOf(result.current.overlay['anchor-a'])).toContain('CONTINUED'))

    // The original cached parts array is unchanged — streaming wrote to a clone.
    expect(priorParts).toHaveLength(1)
    expect(textOf(priorParts)).toBe('PRIOR ')
  })

  it('N4 — terminal classification drives onFinish (success / paused / error)', async () => {
    const onFinish = vi.fn()
    const ui = [asst('anchor-a')]
    renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui, { onFinish }))

    fake.emit(A, { type: 'text-start', id: 't' } as CherryUIMessageChunk)
    fake.emit(A, { type: 'text-delta', id: 't', delta: 'x' } as CherryUIMessageChunk)
    fake.emit(A, { type: 'text-end', id: 't' } as CherryUIMessageChunk)
    fake.terminal(A, { isAbort: true, isError: false })

    await waitFor(() => expect(onFinish).toHaveBeenCalled())
    const [execId, event] = onFinish.mock.calls[0]
    expect(execId).toBe(A)
    expect(event.isAbort).toBe(true)
    expect(event.isError).toBe(false)
  })

  it('N5 — temp topic (no anchor): overlay/liveAssistants keyed by start-chunk id', async () => {
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A)], []))

    streamText(A, 't', 'tempReply', { startId: 'gen-1' })

    await waitFor(() => {
      expect(textOf(result.current.overlay['gen-1'])).toBe('tempReply')
      expect(result.current.liveAssistants.at(-1)?.id).toBe('gen-1')
    })
  })

  it('disposeOverlay drops a single entry by message id', async () => {
    const ui = [asst('anchor-a')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))
    streamText(A, 't', 'bye')
    await waitFor(() => expect(result.current.overlay['anchor-a']).toBeDefined())
    act(() => result.current.disposeOverlay('anchor-a'))
    await waitFor(() => expect(result.current.overlay['anchor-a']).toBeUndefined())
  })
})
