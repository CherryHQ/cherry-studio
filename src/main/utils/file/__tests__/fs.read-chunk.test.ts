import type * as NodeFsPromises from 'node:fs/promises'

import type { AbsoluteFilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpen = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return { ...actual, open: mockOpen }
})

const { readChunk } = await import('../fs')

describe('readChunk consecutive short reads', () => {
  const read = vi.fn()
  const close = vi.fn()

  beforeEach(() => {
    read.mockReset()
    close.mockReset()
    mockOpen.mockReset()
    mockOpen.mockResolvedValue({ read, close })
  })

  it('continues reading while advancing buffer and file positions until the range is full', async () => {
    read
      .mockImplementationOnce(async (buffer: Uint8Array, bufferOffset: number) => {
        buffer.set([1, 2], bufferOffset)
        return { bytesRead: 2, buffer }
      })
      .mockImplementationOnce(async (buffer: Uint8Array, bufferOffset: number) => {
        buffer.set([3], bufferOffset)
        return { bytesRead: 1, buffer }
      })
      .mockImplementationOnce(async (buffer: Uint8Array, bufferOffset: number) => {
        buffer.set([4, 5], bufferOffset)
        return { bytesRead: 2, buffer }
      })

    const chunk = await readChunk('/tmp/report.pdf' as AbsoluteFilePath, 10, 5)

    expect(Array.from(chunk)).toEqual([1, 2, 3, 4, 5])
    expect(read).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), 0, 5, 10)
    expect(read).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), 2, 3, 12)
    expect(read).toHaveBeenNthCalledWith(3, expect.any(Uint8Array), 3, 2, 13)
    expect(close).toHaveBeenCalledOnce()
  })
})
