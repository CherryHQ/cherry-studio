import type { BrowserCursorState } from '@shared/types/browserCursor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserCursor } from '../BrowserCursor'
import { BrowserSessionError } from '../session/BrowserSessionError'

describe('Browser cursor arrival contract', () => {
  let cursor: BrowserCursor
  let states: BrowserCursorState[]
  let focused: boolean
  const identity = { sessionId: 'session', tabId: 'tab' }

  beforeEach(() => {
    vi.useFakeTimers()
    states = []
    focused = true
    cursor = new BrowserCursor(
      identity,
      (state) => states.push(state),
      () => focused,
      () => 1.25
    )
    cursor.setPresented(true)
  })
  afterEach(() => {
    cursor.dispose()
    vi.useRealTimers()
  })

  it('does not release input for an acknowledgement from another target, document or move', async () => {
    let arrived = false
    const wait = cursor.move({ x: 30, y: 50 }, 'document', {}).then(() => {
      arrived = true
    })
    const sequence = states.at(-1)!.sequence
    for (const wrong of [
      { tabId: 'other' },
      { sessionId: 'other' },
      { documentId: 'old' },
      { sequence: sequence - 1 }
    ]) {
      cursor.arrive({ ...identity, documentId: 'document', sequence, ...wrong })
      await Promise.resolve()
      expect(arrived).toBe(false)
    }
    cursor.arrive({ ...identity, documentId: 'document', sequence })
    await wait
    expect(arrived).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(states.at(-1)).toMatchObject({ x: 30, y: 50, scale: 1.25 })
  })

  it('bounds a missing renderer acknowledgement and cancels its late animation', async () => {
    const wait = cursor.move({ x: 1, y: 2 }, 'document', {})
    await vi.advanceTimersByTimeAsync(250)
    expect(await wait).toBe(true)
    expect(states.at(-1)?.kind).toBe('hidden')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the remaining action deadline for the visual wait', async () => {
    const wait = cursor.move({ x: 1, y: 2 }, 'document', { deadline: Date.now() + 20 })
    await vi.advanceTimersByTimeAsync(20)
    await wait
    expect(states.at(-1)?.kind).toBe('hidden')
  })

  it('skips presentation work for hidden and unfocused hosts', async () => {
    cursor.setPresented(false)
    expect(await cursor.move({ x: 1, y: 2 }, 'document', {})).toBe(false)
    cursor.setPresented(true)
    focused = false
    expect(await cursor.move({ x: 1, y: 2 }, 'document', {})).toBe(false)
    expect(states).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases visual waiting immediately when the pane disappears', async () => {
    const wait = cursor.move({ x: 1, y: 2 }, 'document', {})
    cursor.setPresented(false)
    await wait
    expect(states.at(-1)?.kind).toBe('hidden')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects pending input on cancellation instead of treating it as arrival', async () => {
    const abort = new AbortController()
    const wait = cursor.move({ x: 1, y: 2 }, 'document', { signal: abort.signal })
    const rejection = expect(wait).rejects.toThrow('cancelled')
    abort.abort(new Error('cancelled'))
    await rejection
    expect(states.at(-1)?.kind).toBe('hidden')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates a pending move when the document or binding ends', async () => {
    const wait = cursor.move({ x: 1, y: 2 }, 'document', {})
    const rejection = expect(wait).rejects.toMatchObject({ code: 'stale_ref' })
    cursor.hide(new BrowserSessionError('stale_ref'))
    await rejection
    cursor.dispose()
    await expect(cursor.move({ x: 1, y: 2 }, 'document', {})).rejects.toMatchObject({ code: 'not_found' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let a timed-out move acknowledge the following move', async () => {
    const first = cursor.move({ x: 1, y: 2 }, 'document', {})
    const oldSequence = states.at(-1)!.sequence
    await vi.advanceTimersByTimeAsync(250)
    await first
    let arrived = false
    const second = cursor.move({ x: 3, y: 4 }, 'document', {}).then(() => {
      arrived = true
    })
    const sequence = states.at(-1)!.sequence
    cursor.arrive({ ...identity, sequence: oldSequence, documentId: 'document' })
    await Promise.resolve()
    expect(arrived).toBe(false)
    cursor.arrive({ ...identity, sequence, documentId: 'document' })
    await second
  })
})
