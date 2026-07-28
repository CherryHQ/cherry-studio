import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { StreamDoneResult, StreamErrorResult } from '../../types'
import { SseListener } from '../SseListener'

function delta(text: string): UIMessageChunk {
  return { type: 'text-delta', id: 't', delta: text } as UIMessageChunk
}

describe('SseListener', () => {
  it('skips all writes once alive() returns false', () => {
    const write = vi.fn()
    const end = vi.fn()
    const listener = new SseListener(write, end, () => false)

    listener.onChunk(delta('hi'))
    listener.onDone({ status: 'success' } as StreamDoneResult)
    listener.onError({ status: 'error', error: { name: 'E', message: 'boom', stack: null } } as StreamErrorResult)

    expect(write).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })

  it('writes the chunk while alive()', () => {
    const write = vi.fn()
    const listener = new SseListener(write, vi.fn(), () => true)

    listener.onChunk(delta('hi'))

    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('text-delta')
  })

  it('skips a chunk when mapChunk returns null and writes when it maps a value', () => {
    const write = vi.fn()
    const mapChunk = vi.fn((chunk: UIMessageChunk) =>
      (chunk as { delta?: string }).delta === 'drop' ? null : { ok: 1 }
    )
    const listener = new SseListener(write, vi.fn(), () => true, { mapChunk })

    // null → skipped, no write.
    listener.onChunk(delta('drop'))
    expect(write).not.toHaveBeenCalled()

    // mapped value → written.
    listener.onChunk(delta('keep'))
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(`data: ${JSON.stringify({ ok: 1 })}\n\n`)
  })
})
