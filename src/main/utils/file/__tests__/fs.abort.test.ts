import type * as fsPromises from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const { closeMock, openMock, readMock, lstatMock, realpathMock, statMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  openMock: vi.fn(),
  readMock: vi.fn(),
  lstatMock: vi.fn(),
  realpathMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return { ...actual, open: openMock, lstat: lstatMock, realpath: realpathMock }
})

import { readChunk, readTextFileWithinRoots } from '../fs'

describe('readChunk cancellation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    closeMock.mockResolvedValue(undefined)
    openMock.mockResolvedValue({ close: closeMock, read: readMock, stat: statMock })
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

  it('settles on abort while opening and closes a handle that arrives late', async () => {
    let resolveOpen!: (handle: { close: typeof closeMock; read: typeof readMock }) => void
    const pendingOpen = new Promise<{ close: typeof closeMock; read: typeof readMock }>((resolve) => {
      resolveOpen = resolve
    })
    openMock.mockReturnValue(pendingOpen)
    const controller = new AbortController()

    const operation = readChunk('/notes/pending-open.md' as AbsoluteFilePath, 0, 4, controller.signal)
    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(closeMock).not.toHaveBeenCalled()

    resolveOpen({ close: closeMock, read: readMock })
    await vi.waitFor(() => expect(closeMock).toHaveBeenCalledOnce())
  })

  it('closes the handle when abort arrives after open wins the race', async () => {
    const controller = new AbortController()
    openMock.mockImplementation(() => {
      const opening = Promise.resolve({ close: closeMock, read: readMock })
      void opening.then(() => queueMicrotask(() => controller.abort()))
      return opening
    })

    await expect(readChunk('/notes/opened.md' as AbsoluteFilePath, 0, 4, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(readMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalledOnce()
  })

  it('cancels while snapshot verification is stalled and starts handle cleanup', async () => {
    const fileStat = { dev: 1, ino: 2, size: 4, mtimeMs: 0, isFile: () => true }
    lstatMock.mockResolvedValue(fileStat)
    realpathMock.mockImplementation(async (target: string) => target)
    statMock.mockResolvedValue(fileStat)
    let resolveStat!: (value: typeof fileStat) => void
    const pendingStat = new Promise<typeof fileStat>((resolve) => {
      resolveStat = resolve
    })
    statMock.mockReturnValueOnce(pendingStat)
    closeMock.mockImplementationOnce(() => pendingStat.then(() => undefined))
    const controller = new AbortController()
    const operation = readTextFileWithinRoots('/notes/pending.md' as AbsoluteFilePath, ['/notes' as AbsoluteFilePath], {
      maxBytes: 4,
      signal: controller.signal
    })
    await vi.waitFor(() => expect(statMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(closeMock).toHaveBeenCalledOnce()
    resolveStat(fileStat)
    await expect(closeMock.mock.results[0].value).resolves.toBeUndefined()
  })
})
