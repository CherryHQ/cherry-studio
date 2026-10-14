import { describe, expect, it, vi } from 'vitest'

import { type PreviewDocument, readPreviewDocument, readPreviewRange } from '../source'

function source(size: number, readRange: PreviewDocument['readRange']): PreviewDocument {
  return { size, revision: 'v1', readRange, close: async () => {} }
}

describe('preview byte reads', () => {
  it.each([
    [-1, 1],
    [0, -1],
    [0.5, 1],
    [9, 2],
    [Number.MAX_SAFE_INTEGER + 1, 0]
  ])('rejects invalid range %s + %s before touching the source', async (offset, length) => {
    const read = vi.fn()
    await expect(readPreviewRange(source(10, read), offset, length)).rejects.toMatchObject({ code: 'invalid_range' })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects short reads rather than returning incomplete content', async () => {
    await expect(
      readPreviewRange(
        source(10, async () => new Uint8Array(2)),
        0,
        3
      )
    ).rejects.toMatchObject({ code: 'short_read' })
  })

  it('checks cancellation after a reader completes', async () => {
    const controller = new AbortController()
    const document = source(1, async () => {
      controller.abort()
      return new Uint8Array([1])
    })
    await expect(readPreviewRange(document, 0, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses oversized full reads before reading or allocating source bytes', async () => {
    const read = vi.fn()
    await expect(readPreviewDocument(source(26 * 1024 * 1024, read), 25 * 1024 * 1024)).rejects.toMatchObject({
      code: 'too_large'
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('requests a full document as one whole-file range so hosts can serve it in a single read', async () => {
    const size = 2 * 1024 * 1024 + 3
    const read = vi.fn(async (_offset: number, length: number) => new Uint8Array(length).fill(7))
    const bytes = await readPreviewDocument(source(size, read), size)
    expect(bytes).toHaveLength(size)
    expect(bytes.at(-1)).toBe(7)
    expect(read.mock.calls.map(([offset, length]) => [offset, length])).toEqual([[0, size]])
  })
})
