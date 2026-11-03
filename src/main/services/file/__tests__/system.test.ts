import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const { assertOpenableTargetMock, assertSafePathForDefaultOpenMock, internalOpenMock, internalShowInFolderMock } =
  vi.hoisted(() => ({
    assertSafePathForDefaultOpenMock: vi.fn(),
    assertOpenableTargetMock: vi.fn(),
    internalOpenMock: vi.fn(),
    internalShowInFolderMock: vi.fn()
  }))

vi.mock('../internal/system/openGuard', () => ({
  assertSafePathForDefaultOpen: assertSafePathForDefaultOpenMock,
  assertOpenableTarget: assertOpenableTargetMock
}))

vi.mock('../internal/system/shell', () => ({
  open: internalOpenMock,
  showInFolder: internalShowInFolderMock
}))

const writer = vi.hoisted(() => vi.fn())
vi.mock('../internal/system/clipboard', () => ({ writeFileToClipboard: writer }))

import { copyFileToClipboard, getClipboardCopyStatus, safeOpen, showInFolder } from '../system'

describe('file system helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('safeOpen runs both guards before opening the path', async () => {
    await safeOpen('/tmp/report.md' as AbsoluteFilePath)

    expect(assertSafePathForDefaultOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(assertOpenableTargetMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(internalOpenMock).toHaveBeenCalledWith('/tmp/report.md')
    expect(assertSafePathForDefaultOpenMock.mock.invocationCallOrder[0]).toBeLessThan(
      assertOpenableTargetMock.mock.invocationCallOrder[0]
    )
    expect(assertOpenableTargetMock.mock.invocationCallOrder[0]).toBeLessThan(
      internalOpenMock.mock.invocationCallOrder[0]
    )
  })

  it('safeOpen does not open the path when the safety check fails', async () => {
    const error = new Error('blocked')
    assertSafePathForDefaultOpenMock.mockImplementationOnce(() => {
      throw error
    })

    await expect(safeOpen('/tmp/payload.cmd' as AbsoluteFilePath)).rejects.toBe(error)
    expect(internalOpenMock).not.toHaveBeenCalled()
  })

  it('safeOpen does not open the path when the target is unavailable', async () => {
    const error = new Error('unavailable')
    assertOpenableTargetMock.mockRejectedValueOnce(error)

    await expect(safeOpen('/tmp/deleted/report.md' as AbsoluteFilePath)).rejects.toBe(error)
    expect(internalOpenMock).not.toHaveBeenCalled()
  })

  it('showInFolder delegates to the internal shell primitive', async () => {
    await showInFolder('/tmp/report.md' as AbsoluteFilePath)

    expect(internalShowInFolderMock).toHaveBeenCalledWith('/tmp/report.md')
  })
})

describe('clipboard target availability', () => {
  it('refuses a missing path before writing', async () => {
    const path = '/tmp/issue-23362-definitely-missing/file' as AbsoluteFilePath
    expect(await getClipboardCopyStatus(path)).toEqual({ ok: false, reason: 'missing' })
    await expect(copyFileToClipboard(path)).rejects.toMatchObject({
      code: 'FILE_COPY_TARGET_UNAVAILABLE',
      data: { reason: 'missing', path }
    })
    expect(writer).not.toHaveBeenCalled()
  })
  it('checks readable files, directories, and unreadable files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clipboard-test-'))
    const path = join(dir, 'file.cmd') as AbsoluteFilePath
    try {
      await writeFile(path, 'data')
      for (const target of [path, dir as AbsoluteFilePath]) {
        expect(await getClipboardCopyStatus(target)).toEqual({ ok: true })
        await copyFileToClipboard(target)
        expect(writer).toHaveBeenCalledWith(target)
      }
      await chmod(path, 0)
      expect(await getClipboardCopyStatus(path)).toEqual({ ok: false, reason: 'inaccessible' })
    } finally {
      await chmod(path, 0o600)
      await rm(dir, { recursive: true, force: true })
    }
  })
})
