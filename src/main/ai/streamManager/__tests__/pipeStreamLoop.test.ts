import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { finalizeInterruptedParts } from '../persistence/PersistenceBackend'
import { pipeStreamLoop } from '../pipeStreamLoop'

const PARTIAL_TURN: UIMessageChunk[] = [
  { type: 'start', messageId: 'reply' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'The first integration step is' }
]

function chunkStream(chunks: UIMessageChunk[], failure?: { error: unknown }): ReadableStream<UIMessageChunk> {
  let index = 0
  return new ReadableStream<UIMessageChunk>(
    {
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++])
        else if (failure) controller.error(failure.error)
        else controller.close()
      }
    },
    { highWaterMark: 0 }
  )
}

function textOf(message: CherryUIMessage | undefined): string {
  return (message?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

describe('pipeStreamLoop', () => {
  it('reports an immediate source failure without inventing content', async () => {
    const error = new Error('failed before content')
    const result = await pipeStreamLoop(chunkStream([], { error }), new AbortController().signal, {
      onChunk: () => {}
    })
    expect(result.threw?.error).toBe(error)
    expect(result.finalMessage).toBeUndefined()
    expect(result.accumulationError).toBeUndefined()
  })

  it.each([new Error('Server error mid-response'), undefined])(
    'drains every delivered delta before reporting an upstream rejection (%s)',
    async (error) => {
      const chunks: UIMessageChunk[] = [
        ...PARTIAL_TURN,
        ...Array.from(
          { length: 64 },
          (_, i): UIMessageChunk => ({
            type: 'text-delta',
            id: 't1',
            delta: ` ${i}`
          })
        )
      ]
      const broadcast: UIMessageChunk[] = []
      const result = await pipeStreamLoop(chunkStream(chunks, { error }), new AbortController().signal, {
        onChunk: (chunk) => broadcast.push(chunk)
      })

      expect(broadcast).toEqual(chunks)
      expect(textOf(result.finalMessage)).toBe(
        `The first integration step is ${Array.from({ length: 64 }, (_, i) => i).join(' ')}`
      )
      expect(result.threw).toEqual({ error })
      expect(result.accumulationError).toBeUndefined()
      expect(finalizeInterruptedParts(result.finalMessage!.parts, 'error')).toEqual([
        expect.objectContaining({ type: 'text', text: textOf(result.finalMessage), state: 'done' })
      ])
    }
  )

  it('keeps provider error chunks distinct from accumulation failures and continues accumulating', async () => {
    const result = await pipeStreamLoop(
      chunkStream([
        ...PARTIAL_TURN,
        { type: 'error', errorText: 'Provider unavailable' },
        { type: 'text-delta', id: 't1', delta: ' still available' },
        { type: 'error', errorText: 'Later error' }
      ]),
      new AbortController().signal,
      { onChunk: () => {} }
    )

    expect(textOf(result.finalMessage)).toBe('The first integration step is still available')
    expect(result.streamErrorText).toBe('Provider unavailable')
    expect(result.threw).toBeUndefined()
    expect(result.accumulationError).toBeUndefined()
  })

  it('keeps broadcasting after malformed input and reports the failure with the last valid snapshot', async () => {
    const chunks: UIMessageChunk[] = [
      ...PARTIAL_TURN,
      { type: 'reasoning-end', id: 'missing' },
      ...Array.from({ length: 32 }, (): UIMessageChunk => ({ type: 'text-delta', id: 't1', delta: ' later' })),
      { type: 'text-end', id: 't1' },
      { type: 'finish' }
    ]
    const broadcast: UIMessageChunk[] = []
    const result = await pipeStreamLoop(chunkStream(chunks), new AbortController().signal, {
      onChunk: (chunk) => broadcast.push(chunk)
    })

    expect(broadcast).toEqual(chunks)
    expect(textOf(result.finalMessage)).toBe('The first integration step is')
    expect(result.accumulationError?.error).toMatchObject({ name: 'AI_UIMessageStreamError' })
    expect(result.threw).toBeUndefined()
  })

  it.each(['abort', 'callback-throw'] as const)('stops a pending source and drains content on %s', async (ending) => {
    const abort = new AbortController()
    const stopped = new Error('stop')
    const sourceRead = Promise.withResolvers<void>()
    let cancelReason: unknown
    let index = 0
    const stream = new ReadableStream<UIMessageChunk>({
      pull(controller) {
        if (index < PARTIAL_TURN.length) controller.enqueue(PARTIAL_TURN[index++])
        else sourceRead.resolve()
      },
      cancel(reason) {
        cancelReason = reason
      }
    })
    const received = Promise.withResolvers<void>()
    const run = pipeStreamLoop(stream, abort.signal, {
      onChunk: (chunk) => {
        if (chunk.type !== 'text-delta') return
        received.resolve()
        if (ending === 'callback-throw') throw stopped
      }
    })
    await received.promise
    if (ending === 'abort') {
      await sourceRead.promise
      abort.abort(stopped)
    }
    const result = await run

    expect(cancelReason).toBe(stopped)
    expect(textOf(result.finalMessage)).toBe('The first integration step is')
    expect(result.threw).toEqual(ending === 'callback-throw' ? { error: stopped } : undefined)
    expect(result.accumulationError).toBeUndefined()
    expect(finalizeInterruptedParts(result.finalMessage!.parts, 'paused')).toEqual([
      expect.objectContaining({ type: 'text', state: 'done' })
    ])
  })

  it('does not consume or broadcast a source when already aborted', async () => {
    const abort = new AbortController()
    abort.abort('already stopped')
    let cancelled = false
    const stream = new ReadableStream<UIMessageChunk>({
      cancel() {
        cancelled = true
      }
    })
    const broadcast: UIMessageChunk[] = []
    const result = await pipeStreamLoop(stream, abort.signal, { onChunk: (chunk) => broadcast.push(chunk) })
    expect(cancelled).toBe(true)
    expect(broadcast).toEqual([])
    expect(result.threw).toBeUndefined()
    expect(result.finalMessage).toBeUndefined()
  })

  it('preserves normal completion, metadata and live snapshots', async () => {
    const snapshots: string[] = []
    const result = await pipeStreamLoop(
      chunkStream([
        ...PARTIAL_TURN,
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: 'stop', messageMetadata: { test: 'metadata' } }
      ]),
      new AbortController().signal,
      {
        onChunk: () => {},
        onAccumulatedSnapshot: (message) => snapshots.push(textOf(message))
      }
    )

    expect(result.finalMessage).toMatchObject({
      id: 'reply',
      role: 'assistant',
      metadata: { test: 'metadata' },
      parts: [{ type: 'text', text: 'The first integration step is', state: 'done' }]
    })
    expect(snapshots).toContain('The first integration step is')
    expect(result.threw).toBeUndefined()
    expect(result.streamErrorText).toBeUndefined()
    expect(result.accumulationError).toBeUndefined()
  })

  it('resumes a seeded tool call without losing the existing message', async () => {
    const seed: CherryUIMessage = {
      id: 'reply',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Before tool', state: 'done' },
        { type: 'dynamic-tool', toolName: 'lookup', toolCallId: 'call', state: 'input-available', input: {} }
      ]
    }
    const result = await pipeStreamLoop(
      chunkStream([
        { type: 'tool-output-available', toolCallId: 'call', output: 'found' },
        { type: 'finish', finishReason: 'stop' }
      ]),
      new AbortController().signal,
      { onChunk: () => {}, accumulatorSeed: seed }
    )

    expect(result.finalMessage).toMatchObject({
      id: 'reply',
      parts: [
        { type: 'text', text: 'Before tool', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'call', state: 'output-available', output: 'found' }
      ]
    })
    expect(result.accumulationError).toBeUndefined()
  })

  it('reports setup failures without rejecting the pipe promise', async () => {
    const stream = chunkStream([])
    const reader = stream.getReader()
    try {
      const result = await pipeStreamLoop(stream, new AbortController().signal, { onChunk: () => {} })
      expect(result.threw?.error).toBeInstanceOf(TypeError)
    } finally {
      reader.releaseLock()
    }
  })
})
