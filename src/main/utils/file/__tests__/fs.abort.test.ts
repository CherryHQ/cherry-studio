import type * as fsPromises from 'node:fs/promises'

import type { AbsoluteFilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { closeMock, openMock, readMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  openMock: vi.fn(),
  readMock: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return { ...actual, open: openMock }
})

import { readChunk } from '../fs'

describe('readChunk cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openMock.mockResolvedValue({ close: closeMock, read: readMock })
  })

  it('settles on abort without waiting for an in-flight FileHandle.read', async () => {
    let resolveRead!: (result: { bytesRead: number; buffer: Uint8Array }) => void
    const pendingRead = new Promise<{ bytesRead: number; buffer: Uint8Array }>((resolve) => {
      resolveRead = resolve
    })
    readMock.mockReturnValue(pendingRead)
    closeMock.mockImplementation(() => pendingRead.then(() => undefined))
    const controller = new AbortController()

    const operation = readChunk('/notes/pending.md' as AbsoluteFilePath, 0, 4, controller.signal)
    await vi.waitFor(() => expect(readMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(closeMock).toHaveBeenCalledOnce()

    resolveRead({ bytesRead: 0, buffer: new Uint8Array(4) })
    await expect(closeMock.mock.results[0].value).resolves.toBeUndefined()
  })
})
