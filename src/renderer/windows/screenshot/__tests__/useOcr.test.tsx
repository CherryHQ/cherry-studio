import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OcrTextLine } from '../hooks/useOcr'
import { useOcr } from '../hooks/useOcr'
import type { SelectionRect } from '../types'

const ipc = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipc.request } }))

const writeText = vi.fn()

/** Anything at or above MIN_SIZE, so the hook does not treat it as a drag that just started. */
const SELECTION: SelectionRect = { x: 10, y: 20, width: 100, height: 50 }

const word = (text: string, x: number, y: number, width = 40, height = 12) => ({
  text,
  box: { x, y, width, height },
  confidence: 0.9
})

/** Drives the hook the way the overlay does: one media id, one settled selection. */
function renderOcr(options: { available?: boolean; autoStart?: boolean; bounds?: SelectionRect | null } = {}) {
  const { available = true, autoStart = true, bounds = SELECTION } = options
  return renderHook(
    ({ selection }: { selection: SelectionRect | null }) => useOcr('media-1', selection, 2, available, autoStart),
    { initialProps: { selection: bounds } }
  )
}

/** Let the 200 ms debounce elapse and the resulting request settle. */
async function settleRecognition() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('useOcr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ipc.request.mockReset()
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recognizes the selection in physical pixels once the debounce elapses', async () => {
    ipc.request.mockResolvedValue({ status: 'ok', lines: [[word('hello', 0, 0)]] })
    const { result } = renderOcr()

    // The debounce is what keeps a drag from firing a recognition per pointer move.
    expect(ipc.request).not.toHaveBeenCalled()
    await settleRecognition()

    // Physical pixels, integral: the main-process crop rejects a fractional rect, and
    // a CSS-px region would OCR the wrong quarter of a 2× capture.
    expect(ipc.request).toHaveBeenCalledWith('screenshot.recognize_text', {
      mediaId: 'media-1',
      region: { x: 20, y: 40, width: 200, height: 100 }
    })
    expect(result.current.status).toBe('done')
  })

  it('merges the words of one line into a single span covering their glyphs', async () => {
    ipc.request.mockResolvedValue({
      status: 'ok',
      // As the detector reports them: each glyph run grown by 0.4 of its own height per
      // vertical side and 0.6 per horizontal side, so 'good' is really 28×10 at (106, 54).
      lines: [[word('good', 100, 50, 40, 18), word('morning', 150, 48, 60, 27)]]
    })
    const { result } = renderOcr()
    await settleRecognition()

    // Per-word spans would multiply the gaps the selection logic clamps into and
    // change the copied text; the union box is what one span has to cover.
    expect(result.current.lines).toEqual<OcrTextLine[]>([
      { text: 'good morning', box: { x: 106, y: 54, width: 95, height: 15 } }
    ])
  })

  it('does not recognize a selection smaller than the minimum drag size', async () => {
    renderOcr({ bounds: { x: 0, y: 0, width: 20, height: 20 } })
    await settleRecognition()

    // Otherwise every drag opens with a full recognition of its first few pixels.
    expect(ipc.request).not.toHaveBeenCalled()
  })

  it('waits for an explicit request when auto OCR is off, then recognizes on demand', async () => {
    ipc.request.mockResolvedValue({ status: 'ok', lines: [[word('later', 0, 0)]] })
    const { result } = renderOcr({ autoStart: false })
    await settleRecognition()

    // Without a distinct `pending` state these users would have no way in at all.
    expect(result.current.status).toBe('pending')
    expect(ipc.request).not.toHaveBeenCalled()

    await act(async () => {
      result.current.triggerOcr()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status).toBe('done')
    expect(result.current.lines).toHaveLength(1)
  })

  it('reports the model as unavailable rather than as a region without text', async () => {
    // initData said the model was ready; deleting it in settings while the overlay is
    // open is the path a flattened `{ lines: [] }` result could not express.
    ipc.request.mockResolvedValue({ status: 'unavailable' })
    const { result } = renderOcr()
    await settleRecognition()

    expect(result.current.status).toBe('unavailable')
  })

  it('stays unavailable without asking when the model was already missing at capture time', async () => {
    const { result } = renderOcr({ available: false })
    await settleRecognition()

    expect(result.current.status).toBe('unavailable')
    expect(ipc.request).not.toHaveBeenCalled()
  })

  it('leaves the state untouched when a request is superseded', async () => {
    // `rejected` means "a newer request owns the answer", not "recognition failed": mapping it to
    // `error` flashes a failure, to `done` claims the region has no text. Neither is true.
    ipc.request.mockResolvedValue({ status: 'rejected' })
    const { result } = renderOcr()
    await settleRecognition()

    expect(result.current.status).toBe('recognizing')
    expect(result.current.lines).toEqual([])
  })

  it('surfaces a failed recognition as an error instead of an empty result', async () => {
    ipc.request.mockRejectedValue(new Error('worker died'))
    const { result } = renderOcr()
    await settleRecognition()

    // Silence would read as "this region has no text", sending the user looking for
    // the wrong problem; the capture, annotation and export paths are untouched.
    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('worker died')
    expect(result.current.lines).toEqual([])
  })

  it('drops a result that arrives after the selection moved on', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    ipc.request.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
    const { result, rerender } = renderOcr()
    await settleRecognition()

    ipc.request.mockResolvedValueOnce({ status: 'ok', lines: [[word('current', 0, 0)]] })
    rerender({ selection: { ...SELECTION, width: 160 } })
    await settleRecognition()

    await act(async () => {
      resolveFirst({ status: 'ok', lines: [[word('stale', 0, 0)]] })
    })

    expect(result.current.lines.map((line) => line.text)).toEqual(['current'])
  })

  it('copies every recognized line, newline-joined', async () => {
    ipc.request.mockResolvedValue({
      status: 'ok',
      lines: [[word('first', 0, 0)], [word('second', 0, 20)]]
    })
    const { result } = renderOcr()
    await settleRecognition()

    act(() => result.current.copyText())

    // Joining with anything else runs the lines together into one unusable blob.
    expect(writeText).toHaveBeenCalledWith('first\nsecond')
  })

  it('discards a result from the previous session after a reset', async () => {
    let resolvePrevious: (value: unknown) => void = () => {}
    ipc.request.mockReturnValueOnce(new Promise((resolve) => (resolvePrevious = resolve)))
    const { result } = renderOcr()
    await settleRecognition()

    act(() => result.current.resetOcr())
    await act(async () => {
      resolvePrevious({ status: 'ok', lines: [[word('previous capture', 0, 0)]] })
    })

    // A pooled overlay never unmounts, so a late result would land on the new capture.
    expect(result.current.status).toBe('idle')
    expect(result.current.lines).toEqual([])
  })
})
