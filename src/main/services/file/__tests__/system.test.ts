import type { FilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assertSafePathForDefaultOpenMock, internalOpenMock, internalShowInFolderMock } = vi.hoisted(() => ({
  assertSafePathForDefaultOpenMock: vi.fn(),
  internalOpenMock: vi.fn(),
  internalShowInFolderMock: vi.fn()
}))

vi.mock('../internal/system/openGuard', () => ({
  assertSafePathForDefaultOpen: assertSafePathForDefaultOpenMock
}))

vi.mock('../internal/system/shell', () => ({
  open: internalOpenMock,
  showInFolder: internalShowInFolderMock
}))

import { safeOpen, showInFolder } from '../system'

describe('file system helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('safeOpen checks default-open safety before opening the path', async () => {
    await safeOpen('/tmp/report.md' as FilePath)

    expect(assertSafePathForDefaultOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(internalOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(assertSafePathForDefaultOpenMock.mock.invocationCallOrder[0]).toBeLessThan(
      internalOpenMock.mock.invocationCallOrder[0]
    )
  })

  it('safeOpen does not open the path when the safety check fails', async () => {
    const error = new Error('blocked')
    assertSafePathForDefaultOpenMock.mockImplementationOnce(() => {
      throw error
    })

    await expect(safeOpen('/tmp/payload.cmd' as FilePath)).rejects.toBe(error)
    expect(internalOpenMock).not.toHaveBeenCalled()
  })

  it('showInFolder delegates to the internal shell primitive', async () => {
    await showInFolder('/tmp/report.md' as FilePath)

    expect(internalShowInFolderMock).toHaveBeenCalledWith('/tmp/report.md')
  })
})
