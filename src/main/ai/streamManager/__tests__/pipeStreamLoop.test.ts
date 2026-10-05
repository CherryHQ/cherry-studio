/**
 * Unit tests for `pipeStreamLoop`'s mid-response failure contract: content the
 * broadcast already delivered must survive into `finalMessage`, or the terminal
 * handler persists an empty message and the user's partial reply disappears.
 */

import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { finalizeInterruptedParts } from '../persistence/PersistenceBackend'
import { pipeStreamLoop } from '../pipeStreamLoop'

/** A turn that streamed two sentences and was cut off before the third. */
const PARTIAL_TURN: UIMessageChunk[] = [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'The first integration step is' }
] as UIMessageChunk[]

type Ending = 'throw' | 'error-chunk' | 'clean'

function partialTurnStream(ending: Ending): ReadableStream<UIMessageChunk> {
  let index = 0
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      if (index < PARTIAL_TURN.length) {
        controller.enqueue(PARTIAL_TURN[index++])
        return
      }
      if (ending === 'throw') controller.error(new Error('Server error mid-response'))
      else if (ending === 'error-chunk') {
        controller.enqueue({ type: 'error', errorText: 'Server error mid-response' })
        controller.close()
      } else controller.close()
    }
  })
}

function run(ending: Ending) {
  const broadcast: UIMessageChunk[] = []
  return pipeStreamLoop(partialTurnStream(ending), new AbortController().signal, {
    onChunk: (chunk) => broadcast.push(chunk)
  }).then((result) => ({ ...result, broadcast }))
}

function textOf(message: { parts: Array<{ type: string; text?: string }> } | undefined): string {
  return (message?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

describe('pipeStreamLoop mid-response failures', () => {
  it.each(['throw', 'error-chunk'] as const)(
    'keeps the streamed content when the provider fails (%s)',
    async (ending) => {
      const result = await run(ending)

      // The content reached the listener…
      const deltas = result.broadcast.filter((chunk) => chunk.type === 'text-delta')
      expect(deltas).toHaveLength(1)
      // …so it must also be in the snapshot the terminal handler persists.
      expect(textOf(result.finalMessage)).toBe('The first integration step is')
    }
  )

  it('still reports the failure when content was streamed', async () => {
    const thrown = await run('throw')
    expect(thrown.threw?.error).toBeInstanceOf(Error)

    const chunked = await run('error-chunk')
    expect(chunked.streamErrorText).toBe('Server error mid-response')
  })

  it('closes the trailing text part so the persisted message is readable', async () => {
    // An unterminated part renders as a still-typing cursor instead of the truncated sentence.
    for (const ending of ['throw', 'error-chunk'] as const) {
      const result = await run(ending)
      const persisted = finalizeInterruptedParts(result.finalMessage?.parts ?? [], 'error')
      const textParts = persisted.filter((part) => part.type === 'text')
      expect(textParts).toHaveLength(1)
      expect(textParts.every((part) => part.state === 'done')).toBe(true)
    }
  })

  it('leaves a clean stream unchanged', async () => {
    const result = await run('clean')
    expect(result.threw).toBeUndefined()
    expect(result.streamErrorText).toBeUndefined()
    expect(textOf(result.finalMessage)).toBe('The first integration step is')
  })

  it('drops nothing when no chunks were streamed before the failure', async () => {
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.error(new Error('failed immediately'))
      }
    })
    const result = await pipeStreamLoop(stream, new AbortController().signal, { onChunk: () => {} })

    expect(result.threw?.error).toBeInstanceOf(Error)
    // A turn that produced no content has nothing to preserve.
    expect(textOf(result.finalMessage)).toBe('')
  })
})
