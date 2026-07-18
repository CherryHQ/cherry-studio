import type { ExecutionTerminal } from '@renderer/services/aiTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Controllable fake TopicStreamSubscription ───────────────────────────
const { fake } = vi.hoisted(() => {
  type Branch = {
    executionId: string
    anchorMessageId?: string
    stream: ReadableStream<unknown>
    controller: ReadableStreamDefaultController<unknown>
  }
  const branches = new Map<string, Branch>()
  const terminalCbs = new Set<(id: string, t: ExecutionTerminal) => void>()
  const keyOf = (executionId: string, anchorMessageId?: string) =>
    JSON.stringify([executionId, anchorMessageId ?? null])
  const findBranch = (executionId: string, anchorMessageId?: string) => {
    const exact = branches.get(keyOf(executionId, anchorMessageId))
    if (exact || anchorMessageId !== undefined) return exact
    return [...branches.values()].find((branch) => branch.executionId === executionId)
  }
  const api = {
    branches,
    terminalCbs,
    register(executionId: string, anchorMessageId?: string) {
      const key = keyOf(executionId, anchorMessageId)
      let b = branches.get(key)
      if (!b) {
        let controller!: ReadableStreamDefaultController<unknown>
        const stream = new ReadableStream<unknown>({ start: (c) => (controller = c) })
        b = { executionId, anchorMessageId, stream, controller }
        branches.set(key, b)
      }
      return b.stream
    },
    unregister(executionId: string, anchorMessageId?: string) {
      const key = keyOf(executionId, anchorMessageId)
      const b = branches.get(key)
      try {
        b?.controller.close()
      } catch {
        /* already closed */
      }
      branches.delete(key)
    },
    onExecutionTerminal(cb: (id: string, t: ExecutionTerminal) => void) {
      terminalCbs.add(cb)
      return () => terminalCbs.delete(cb)
    },
    // test helpers
    emit(executionId: string, chunk: CherryUIMessageChunk, anchorMessageId?: string) {
      findBranch(executionId, anchorMessageId)?.controller.enqueue(chunk)
    },
    close(executionId: string, anchorMessageId?: string) {
      try {
        findBranch(executionId, anchorMessageId)?.controller.close()
      } catch {
        /* noop */
      }
    },
    terminal(executionId: string, t: ExecutionTerminal, anchorMessageId?: string) {
      for (const cb of terminalCbs) cb(executionId, { ...t, anchorMessageId })
      api.close(executionId, anchorMessageId)
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

function streamText(
  executionId: string,
  textId: string,
  text: string,
  opts?: { startId?: string; anchorMessageId?: string }
) {
  if (opts?.startId) {
    fake.emit(executionId, { type: 'start', messageId: opts.startId } as CherryUIMessageChunk, opts.anchorMessageId)
  }
  fake.emit(executionId, { type: 'text-start', id: textId } as CherryUIMessageChunk, opts?.anchorMessageId)
  fake.emit(executionId, { type: 'text-delta', id: textId, delta: text } as CherryUIMessageChunk, opts?.anchorMessageId)
  fake.emit(executionId, { type: 'text-end', id: textId } as CherryUIMessageChunk, opts?.anchorMessageId)
  fake.emit(executionId, { type: 'finish' } as CherryUIMessageChunk, opts?.anchorMessageId)
}

function textOf(parts: CherryUIMessage['parts'] | undefined): string {
  return (parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function installControlledAnimationFrames() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id)
  })

  return {
    callbacks,
    request,
    cancel,
    runNext() {
      const entry = callbacks.entries().next().value
      if (!entry) return
      callbacks.delete(entry[0])
      entry[1](performance.now())
    }
  }
}

async function drainStreamMicrotasks(): Promise<void> {
  for (let index = 0; index < 24; index++) {
    await Promise.resolve()
  }
}

beforeEach(() => fake.reset())
afterEach(() => {
  fake.reset()
  vi.restoreAllMocks()
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

  it('N2b — same model direct anchor switch starts a fresh reader', async () => {
    const ui1 = [asst('anchor-1')]
    const { result, rerender } = renderHook(
      ({ execs, ui }: { execs: ActiveExecution[]; ui: CherryUIMessage[] }) => useExecutionOverlay(TOPIC, execs, ui),
      { initialProps: { execs: [exec(A, 'anchor-1')], ui: ui1 } }
    )

    streamText(A, 't1', 'round-1', { anchorMessageId: 'anchor-1' })
    await waitFor(() => expect(textOf(result.current.overlay['anchor-1'])).toBe('round-1'))

    const ui2 = [asst('anchor-1', [{ type: 'text', text: 'round-1' }]), asst('anchor-2')]
    await act(async () => {
      rerender({ execs: [exec(A, 'anchor-2')], ui: ui2 })
      await Promise.resolve()
    })

    streamText(A, 't2', 'round-2', { anchorMessageId: 'anchor-2' })
    await waitFor(() => expect(textOf(result.current.overlay['anchor-2'])).toBe('round-2'))
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

  it('structurally shares protocol-settled parts while the live frontier advances', async () => {
    const ui = [asst('anchor-a')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))

    fake.emit(A, { type: 'text-start', id: 't1' } as CherryUIMessageChunk)
    fake.emit(A, { type: 'text-delta', id: 't1', delta: 'settled text' } as CherryUIMessageChunk)
    fake.emit(A, { type: 'text-end', id: 't1' } as CherryUIMessageChunk)
    await waitFor(() => expect(result.current.overlay['anchor-a']?.[0]).toMatchObject({ state: 'done' }))
    const settledText = result.current.overlay['anchor-a'][0]

    fake.emit(A, {
      type: 'tool-input-start',
      toolCallId: 'tool-1',
      toolName: 'search',
      dynamic: true
    } as CherryUIMessageChunk)
    await waitFor(() => expect(result.current.overlay['anchor-a']).toHaveLength(2))
    expect(result.current.overlay['anchor-a'][0]).toBe(settledText)

    fake.emit(A, {
      type: 'tool-output-available',
      toolCallId: 'tool-1',
      output: { phase: 'preliminary' },
      preliminary: true
    } as CherryUIMessageChunk)
    await waitFor(() =>
      expect(result.current.overlay['anchor-a'][1]).toMatchObject({ output: { phase: 'preliminary' } })
    )
    const preliminaryTool = result.current.overlay['anchor-a'][1]

    fake.emit(A, {
      type: 'tool-output-available',
      toolCallId: 'tool-1',
      output: { phase: 'final' }
    } as CherryUIMessageChunk)
    await waitFor(() => expect(result.current.overlay['anchor-a'][1]).toMatchObject({ output: { phase: 'final' } }))
    const settledTool = result.current.overlay['anchor-a'][1]
    expect(settledTool).not.toBe(preliminaryTool)

    fake.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk)
    await waitFor(() => expect(result.current.overlay['anchor-a']).toHaveLength(3))
    expect(result.current.overlay['anchor-a'][0]).toBe(settledText)
    expect(result.current.overlay['anchor-a'][1]).toBe(settledTool)
  })

  it('coalesces burst snapshots from every execution into one render per animation frame', async () => {
    const frames = installControlledAnimationFrames()
    const ui = [asst('anchor-a'), asst('anchor-b')]
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useExecutionOverlay(TOPIC, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], ui)
    })

    await act(async () => {
      fake.emit(A, { type: 'text-start', id: 'ta' } as CherryUIMessageChunk)
      fake.emit(A, { type: 'text-delta', id: 'ta', delta: 'a' } as CherryUIMessageChunk)
      fake.emit(A, { type: 'text-delta', id: 'ta', delta: 'b' } as CherryUIMessageChunk)
      fake.emit(B, { type: 'text-start', id: 'tb' } as CherryUIMessageChunk)
      fake.emit(B, { type: 'text-delta', id: 'tb', delta: 'x' } as CherryUIMessageChunk)
      fake.emit(B, { type: 'text-delta', id: 'tb', delta: 'y' } as CherryUIMessageChunk)
      await drainStreamMicrotasks()
    })

    expect(frames.request).toHaveBeenCalledTimes(1)
    expect(result.current.overlay).toEqual({})
    const beforeFrameRenderCount = renderCount

    act(() => frames.runNext())

    expect(textOf(result.current.overlay['anchor-a'])).toBe('ab')
    expect(textOf(result.current.overlay['anchor-b'])).toBe('xy')
    expect(renderCount).toBe(beforeFrameRenderCount + 1)
  })

  it('flushes a terminal snapshot immediately instead of waiting for the next frame', async () => {
    const frames = installControlledAnimationFrames()
    const onFinish = vi.fn()
    const ui = [asst('anchor-a')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui, { onFinish }))

    await act(async () => {
      fake.emit(A, { type: 'text-start', id: 't' } as CherryUIMessageChunk)
      fake.emit(A, { type: 'text-delta', id: 't', delta: 'final' } as CherryUIMessageChunk)
      fake.emit(A, { type: 'text-end', id: 't' } as CherryUIMessageChunk)
      fake.terminal(A, { isAbort: false, isError: false })
      await drainStreamMicrotasks()
    })

    expect(textOf(result.current.overlay['anchor-a'])).toBe('final')
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(frames.callbacks.size).toBe(0)
    expect(frames.cancel).toHaveBeenCalledTimes(1)
  })

  it('prevents a cancelled frame from restoring snapshots after reset', async () => {
    const frames = installControlledAnimationFrames()
    const ui = [asst('anchor-a')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))

    await act(async () => {
      fake.emit(A, { type: 'text-start', id: 't' } as CherryUIMessageChunk)
      fake.emit(A, { type: 'text-delta', id: 't', delta: 'stale' } as CherryUIMessageChunk)
      await drainStreamMicrotasks()
    })
    const staleFrame = frames.callbacks.values().next().value as FrameRequestCallback

    act(() => result.current.reset())
    expect(frames.callbacks.size).toBe(0)

    act(() => staleFrame(performance.now()))

    expect(result.current.overlay).toEqual({})
  })

  it('keeps live message metadata from message-metadata chunks', async () => {
    const ui = [asst('anchor-a')]
    const { result } = renderHook(() => useExecutionOverlay(TOPIC, [exec(A, 'anchor-a')], ui))

    fake.emit(A, {
      type: 'message-metadata',
      messageMetadata: { thoughtsTokens: 321 }
    } as CherryUIMessageChunk)

    await waitFor(() => {
      expect(result.current.liveAssistants.at(-1)?.metadata?.thoughtsTokens).toBe(321)
    })
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

  it('does NOT fire onFinish when an execution leaves activeExecutions (why the status-driven handoff exists)', async () => {
    // When the topic goes terminal, the execution drops out of `activeExecutions`
    // and the teardown loop `cancel()`s the reader, which SUPPRESSES `onFinish`.
    // So overlay disposal cannot ride `onFinish` — it must be driven off the
    // terminal status (see `useTopicOverlayHandoffOnTerminal`). This locks that
    // assumption: if someone "fixes" onFinish to fire here, the handoff design
    // must be revisited.
    const onFinish = vi.fn()
    const ui = [asst('anchor-a')]
    const { rerender } = renderHook(
      ({ execs }: { execs: ActiveExecution[] }) => useExecutionOverlay(TOPIC, execs, ui, { onFinish }),
      { initialProps: { execs: [exec(A, 'anchor-a')] } }
    )

    // Execution leaves activeExecutions WITHOUT the overlay's own terminal signal.
    await act(async () => {
      rerender({ execs: [] })
      await Promise.resolve()
    })

    expect(onFinish).not.toHaveBeenCalled()
  })
})
