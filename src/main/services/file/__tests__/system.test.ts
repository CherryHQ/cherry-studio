import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import type * as OpenGuardModule from '../internal/system/openGuard'

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

import { copyFileToClipboard, getClipboardCopyStatus, safeOpen } from '../system'

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

  it.each([
    [{ channel: 'file.open' } as const, 'file.open'],
    [undefined, 'unknown']
  ])('records one accepted handoff with context %j', async (context, channel) => {
    const path = '/tmp/中文 report.docx' as AbsoluteFilePath
    await expect(safeOpen(path, context)).resolves.toBeUndefined()
    expect(internalOpenMock).toHaveBeenCalledExactlyOnceWith(path)
    expect(mockMainLoggerService.info).toHaveBeenCalledExactlyOnceWith('Default-app open handoff completed', {
      path,
      extension: 'docx',
      platform: process.platform,
      channel,
      targetKind: 'system_default',
      targetApplication: 'unknown',
      outcome: 'accepted',
      durationMs: expect.any(Number)
    })
    const { durationMs } = mockMainLoggerService.info.mock.calls[0][1]
    expect(Number.isFinite(durationMs)).toBe(true)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it.each([
    [new Error('shell refused'), 'shell refused'],
    ['string rejection', 'string rejection'],
    [{ secret: 'do not serialize' }, 'Unknown error'],
    [null, 'Unknown error']
  ])('records failure and preserves rejection identity for %j', async (originalError, failureReason) => {
    const path = '/tmp/report.docx' as AbsoluteFilePath
    internalOpenMock.mockRejectedValueOnce(originalError)
    await expect(safeOpen(path)).rejects.toBe(originalError)
    expect(internalOpenMock).toHaveBeenCalledExactlyOnceWith(path)
    expect(mockMainLoggerService.info).toHaveBeenCalledExactlyOnceWith('Default-app open handoff completed', {
      path,
      extension: 'docx',
      platform: process.platform,
      channel: 'unknown',
      targetKind: 'system_default',
      targetApplication: 'unknown',
      outcome: 'failed',
      failureReason,
      durationMs: expect.any(Number)
    })
  })

  it('scrubs credentials before truncating the failure reason', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    const originalError = new Error(`password=hunter2\nbare ${secret} ${'x'.repeat(600)}`)
    internalOpenMock.mockRejectedValueOnce(originalError)
    await expect(safeOpen('/tmp/report.docx' as AbsoluteFilePath)).rejects.toBe(originalError)
    expect(mockMainLoggerService.info).toHaveBeenCalledTimes(1)
    const { failureReason } = mockMainLoggerService.info.mock.calls[0][1]
    expect(failureReason).toBe(('password="<redacted>"\nbare <redacted> ' + 'x'.repeat(600)).slice(0, 500))
    expect(failureReason).not.toContain(secret)
    expect(failureReason).not.toContain('hunter2')
    expect(failureReason.length).toBeLessThanOrEqual(500)
  })

  it('resolves a successful handoff even when logging fails without emitting a failed record', async () => {
    const error = new Error('logger failed')
    mockMainLoggerService.info.mockImplementationOnce(() => {
      throw error
    })
    await expect(safeOpen('/tmp/report.docx' as AbsoluteFilePath)).resolves.toBeUndefined()
    expect(internalOpenMock).toHaveBeenCalledTimes(1)
    expect(mockMainLoggerService.info).toHaveBeenCalledTimes(1)
    expect(mockMainLoggerService.info.mock.calls[0][1].outcome).toBe('accepted')
  })

  it('preserves the original handoff rejection even when failure logging throws', async () => {
    const path = '/tmp/report.docx' as AbsoluteFilePath
    const originalError = new Error('shell refused')
    internalOpenMock.mockRejectedValueOnce(originalError)
    mockMainLoggerService.info.mockImplementationOnce(() => {
      throw new Error('logger failed')
    })
    await expect(safeOpen(path)).rejects.toBe(originalError)
    expect(internalOpenMock).toHaveBeenCalledExactlyOnceWith(path)
    expect(mockMainLoggerService.info).toHaveBeenCalledExactlyOnceWith('Default-app open handoff completed', {
      path,
      extension: 'docx',
      platform: process.platform,
      channel: 'unknown',
      targetKind: 'system_default',
      targetApplication: 'unknown',
      outcome: 'failed',
      failureReason: 'shell refused',
      durationMs: expect.any(Number)
    })
  })

  it('preserves the original extension-guard rejection without checking availability or logging', async () => {
    const error = new Error('blocked')
    assertSafePathForDefaultOpenMock.mockImplementationOnce(() => {
      throw error
    })
    await expect(safeOpen('/tmp/payload.cmd' as AbsoluteFilePath)).rejects.toBe(error)
    expect(assertOpenableTargetMock).not.toHaveBeenCalled()
    expect(internalOpenMock).not.toHaveBeenCalled()
    expect(mockMainLoggerService.info).not.toHaveBeenCalled()
  })

  it.each(['/tmp/payload.cmd', '/tmp/payload.exe ', '/tmp/payload.exe.'])(
    'does not check availability, open, or log an unsafe target %s',
    async (path) => {
      const { assertSafePathForDefaultOpen } =
        await vi.importActual<typeof OpenGuardModule>('../internal/system/openGuard')
      assertSafePathForDefaultOpenMock.mockImplementationOnce(assertSafePathForDefaultOpen)
      await expect(safeOpen(path as AbsoluteFilePath)).rejects.toMatchObject({ code: 'FILE_OPEN_BLOCKED_UNSAFE_TYPE' })
      expect(assertOpenableTargetMock).not.toHaveBeenCalled()
      expect(internalOpenMock).not.toHaveBeenCalled()
      expect(mockMainLoggerService.info).not.toHaveBeenCalled()
    }
  )

  it.each(['missing', 'inaccessible'])('does not open or log a %s target', async (reason) => {
    const { IpcError } = await import('@shared/ipc/errors/IpcError')
    const error = new IpcError('FILE_OPEN_TARGET_UNAVAILABLE', 'unavailable', { reason })
    assertOpenableTargetMock.mockRejectedValueOnce(error)
    await expect(safeOpen('/tmp/deleted/report.md' as AbsoluteFilePath)).rejects.toBe(error)
    expect(internalOpenMock).not.toHaveBeenCalled()
    expect(mockMainLoggerService.info).not.toHaveBeenCalled()
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
  it('checks readable files and directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clipboard-test-'))
    const path = join(dir, 'file.cmd') as AbsoluteFilePath
    try {
      await writeFile(path, 'data')
      for (const target of [path, dir as AbsoluteFilePath]) {
        expect(await getClipboardCopyStatus(target)).toEqual({ ok: true })
        await copyFileToClipboard(target)
        expect(writer).toHaveBeenCalledWith(target)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // chmod cannot strip read permission on Windows.
  it.skipIf(process.platform === 'win32')('checks unreadable files (POSIX)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clipboard-test-'))
    const path = join(dir, 'file.cmd') as AbsoluteFilePath
    try {
      await writeFile(path, 'data')
      await chmod(path, 0)
      expect(await getClipboardCopyStatus(path)).toEqual({ ok: false, reason: 'inaccessible' })
    } finally {
      await chmod(path, 0o600)
      await rm(dir, { recursive: true, force: true })
    }
  })
})
