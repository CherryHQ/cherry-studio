// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: ipcMocks }))

import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FilePath } from '@shared/types/file'

import { FILE_EDIT_MAX_SIZE_BYTES, useFileEditSession } from '../useFileEditSession'

const path = '/ws/notes.txt' as FilePath

function utf8(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

function readResult(content: Uint8Array, mtime = 1) {
  return { content, mime: 'text/plain', version: { mtime, size: content.byteLength } }
}

function writeResult(mtime: number, size: number) {
  return { mtime, size }
}

function writeCalls() {
  return ipcMocks.request.mock.calls.filter(([route]) => route === 'file.write_if_unchanged')
}

// Fresh SWR cache per render so file content never bleeds across tests.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

function renderSession() {
  return renderHook(() => useFileEditSession(path), { wrapper })
}

beforeEach(() => ipcMocks.request.mockReset())

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useFileEditSession', () => {
  it('loads and seeds the draft from disk', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
    const { result } = renderSession()

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(ipcMocks.request).toHaveBeenCalledWith('file.read', {
      handle: { kind: 'path', path },
      options: { encoding: 'binary' }
    })
    expect(result.current.draft).toBe('hello\n')
    expect(result.current.savedContent).toBe('hello\n')
    expect(result.current.savedSizeBytes).toBe(6)
    expect(result.current.isDirty).toBe(false)
  })

  it('autosaves after the debounce window, not before', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe('ready')

      act(() => result.current.setDraft('changed\n'))
      ipcMocks.request.mockResolvedValueOnce(writeResult(2, 8))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(799)
      })
      expect(ipcMocks.request).not.toHaveBeenCalledWith('file.write_if_unchanged', expect.anything())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.write_if_unchanged', {
        path,
        data: utf8('changed\n'),
        expectedVersion: { mtime: 1, size: 6 }
      })
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('carries the version returned by one save into the next save', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('first'))
      ipcMocks.request.mockResolvedValueOnce(writeResult(2, 5))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      act(() => result.current.setDraft('second'))
      ipcMocks.request.mockResolvedValueOnce(writeResult(3, 6))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(writeCalls()[1]?.[1]).toMatchObject({
        expectedVersion: { mtime: 2, size: 5 }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes writes: an edit during an in-flight write waits, then rebases onto its result', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      // Write #1 hangs (slow disk).
      let resolveWrite!: (value: ReturnType<typeof writeResult>) => void
      ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveWrite = resolve)))
      act(() => result.current.setDraft('first'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(writeCalls()).toHaveLength(1)

      // Keep typing while #1 is still in flight; its debounce elapses too.
      act(() => result.current.setDraft('first and second'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      // No overlapping dispatch with a stale baseline.
      expect(writeCalls()).toHaveLength(1)

      // Settle #1; the coalesced follow-up write fires with #1's returned version.
      ipcMocks.request.mockResolvedValueOnce(writeResult(3, 16))
      await act(async () => {
        resolveWrite(writeResult(2, 5))
        await vi.advanceTimersByTimeAsync(0)
      })

      const calls = writeCalls()
      expect(calls).toHaveLength(2)
      expect(calls[1]?.[1]).toMatchObject({
        data: utf8('first and second'),
        expectedVersion: { mtime: 2, size: 5 }
      })
      expect(result.current.conflict).toBe(false)
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags a conflict only when a stale write verifies as truly diverged, and pauses autosave', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('changed'))
      ipcMocks.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        // Verification read: disk holds something else entirely.
        .mockResolvedValueOnce(readResult(utf8('external\n'), 9))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(result.current.conflict).toBe(true)
      // Draft is preserved for the user to keep editing.
      expect(result.current.draft).toBe('changed')

      // Paused: further edits do not write while in conflict.
      ipcMocks.request.mockClear()
      act(() => result.current.setDraft('changed again'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(ipcMocks.request).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts a stale write whose content already matches the disk (no conflict)', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('changed'))
      ipcMocks.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        // Verification read: disk already holds exactly what we tried to write.
        .mockResolvedValueOnce(readResult(utf8('changed'), 5))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(result.current.conflict).toBe(false)
      expect(result.current.savedContent).toBe('changed')
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rebases and retries a stale write when the disk content is unchanged (metadata touch)', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('changed'))
      ipcMocks.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        // Verification read: same content as our baseline, only the version moved.
        .mockResolvedValueOnce(readResult(utf8('hello\n'), 7))
        // Retried write succeeds against the rebased version.
        .mockResolvedValueOnce(writeResult(8, 7))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(result.current.conflict).toBe(false)
      expect(result.current.savedContent).toBe('changed')
      const calls = writeCalls()
      expect(calls).toHaveLength(2)
      expect(calls[1]?.[1]).toMatchObject({
        expectedVersion: { mtime: 7, size: 6 }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces an IO save failure, pauses autosave, and clears the error after an explicit retry', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('draft'))
      const diskFull = new Error('disk full')
      ipcMocks.request.mockRejectedValueOnce(diskFull)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      expect(result.current.isDirty).toBe(true)
      expect(result.current.draft).toBe('draft')
      expect(result.current.conflict).toBe(false)
      expect(result.current.saveError).toBe(diskFull)

      // Further edits stay in memory without repeatedly hitting the same I/O
      // failure. An explicit flush retries the latest draft.
      ipcMocks.request.mockClear()
      act(() => result.current.setDraft('draft 2'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(ipcMocks.request).not.toHaveBeenCalled()

      ipcMocks.request.mockResolvedValueOnce(writeResult(2, 7))
      await act(async () => {
        await result.current.flush()
      })
      expect(result.current.isDirty).toBe(false)
      expect(result.current.saveError).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards an unsaved draft after an IO save failure', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('unsaved'))
      ipcMocks.request.mockRejectedValueOnce(new Error('disk full'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })

      act(() => result.current.discard())

      expect(result.current.draft).toBe('hello\n')
      expect(result.current.savedContent).toBe('hello\n')
      expect(result.current.isDirty).toBe(false)
      expect(result.current.saveError).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not discard while an explicit retry write is still running', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
    const { result } = renderSession()
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.setDraft('unsaved'))
    const diskFull = new Error('disk full')
    ipcMocks.request.mockRejectedValueOnce(diskFull)
    await act(async () => {
      await expect(result.current.flush()).rejects.toBe(diskFull)
    })

    let resolveRetry!: (value: ReturnType<typeof writeResult>) => void
    ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)))
    let retryPromise!: Promise<void>
    act(() => {
      retryPromise = result.current.flush()
    })
    await waitFor(() => expect(result.current.isSaving).toBe(true))

    act(() => result.current.discard())
    expect(result.current.draft).toBe('unsaved')
    expect(result.current.isDirty).toBe(true)

    await act(async () => {
      resolveRetry(writeResult(2, 7))
      await retryPromise
    })
    expect(result.current.savedContent).toBe('unsaved')
    expect(result.current.savedSizeBytes).toBe(7)
    expect(writeCalls()).toHaveLength(2)
  })

  it('flush rejects while the draft cannot be persisted, then resolves after a successful retry', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('unsaved'))
      const diskFull = new Error('disk full')
      ipcMocks.request.mockRejectedValueOnce(diskFull)
      await act(async () => {
        await expect(result.current.flush()).rejects.toBe(diskFull)
      })
      expect(result.current.isDirty).toBe(true)

      ipcMocks.request.mockResolvedValueOnce(writeResult(2, 7))
      await act(async () => {
        await result.current.flush()
      })
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush rejects when a conflict leaves the draft unpersisted', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('local'))
      ipcMocks.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        .mockResolvedValueOnce(readResult(utf8('external\n'), 9))

      await act(async () => {
        await expect(result.current.flush()).rejects.toThrow('Pending edit could not be saved')
      })

      expect(result.current.conflict).toBe(true)
      expect(result.current.isDirty).toBe(true)
      expect(result.current.draft).toBe('local')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reload discards local edits and clears the conflict', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('local'))
      ipcMocks.request
        .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
        .mockResolvedValueOnce(readResult(utf8('external\n'), 9))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(result.current.conflict).toBe(true)

      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('external\n'), 9))
      await act(async () => {
        await result.current.reload()
      })
      expect(result.current.draft).toBe('external\n')
      expect(result.current.savedContent).toBe('external\n')
      expect(result.current.conflict).toBe(false)

      // Autosave resumes after reload.
      act(() => result.current.setDraft('after reload'))
      ipcMocks.request.mockResolvedValueOnce(writeResult(10, 12))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush writes the pending draft immediately', async () => {
    vi.useFakeTimers()
    try {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      act(() => result.current.setDraft('flushed'))
      ipcMocks.request.mockResolvedValueOnce(writeResult(2, 7))
      await act(async () => {
        await result.current.flush()
      })

      expect(ipcMocks.request).toHaveBeenCalledWith(
        'file.write_if_unchanged',
        expect.objectContaining({ path, data: utf8('flushed') })
      )
      expect(result.current.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  describe('notifyExternalChange', () => {
    it('ignores a self-save echo via the event mtime without any IPC', async () => {
      vi.useFakeTimers()
      try {
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello')))
        const { result } = renderSession()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        act(() => result.current.setDraft('a'))
        ipcMocks.request.mockResolvedValueOnce(writeResult(2, 1))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(800)
        })
        expect(result.current.savedContent).toBe('a')

        // chokidar reports our own write: raw float mtime of the same stat.
        ipcMocks.request.mockClear()
        await act(async () => {
          result.current.notifyExternalChange(2.4)
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(ipcMocks.request).not.toHaveBeenCalled()
        expect(result.current.conflict).toBe(false)
        expect(result.current.savedContent).toBe('a')
      } finally {
        vi.useRealTimers()
      }
    })

    it('never reloads a dirty model from a watcher event', async () => {
      vi.useFakeTimers()
      try {
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello')))
        const { result } = renderSession()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        act(() => result.current.setDraft('typing…'))
        ipcMocks.request.mockClear()
        await act(async () => {
          result.current.notifyExternalChange(999.9)
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(ipcMocks.request).not.toHaveBeenCalled()
        expect(result.current.conflict).toBe(false)
        expect(result.current.draft).toBe('typing…')

        // Let the pending autosave land so nothing dangles into teardown.
        ipcMocks.request.mockResolvedValueOnce(writeResult(2, 10))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(800)
        })
        expect(result.current.isDirty).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('reloads silently on an idle external change', async () => {
      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello\n')))
      const { result } = renderSession()
      await waitFor(() => expect(result.current.status).toBe('ready'))

      ipcMocks.request.mockResolvedValueOnce(readResult(utf8('external\n'), 5001))
      act(() => result.current.notifyExternalChange(5001.2))
      await waitFor(() => expect(result.current.draft).toBe('external\n'))
      expect(result.current.conflict).toBe(false)
    })

    it('does not trust a whole-second event mtime match and verifies by reading', async () => {
      vi.useFakeTimers()
      try {
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello')))
        const { result } = renderSession()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        // Land a save at a whole-second mtime (second-precision filesystem).
        act(() => result.current.setDraft('a'))
        ipcMocks.request.mockResolvedValueOnce(writeResult(2000, 1))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(800)
        })

        // Event mtime matches (2000) but is ambiguous → a verification read runs.
        ipcMocks.request.mockClear()
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('a'), 2000))
        await act(async () => {
          result.current.notifyExternalChange(2000)
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(ipcMocks.request).toHaveBeenCalledWith('file.read', {
          handle: { kind: 'path', path },
          options: { encoding: 'binary' }
        })
        expect(result.current.savedContent).toBe('a')
        expect(result.current.conflict).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('discards a stale (older-mtime) read instead of overwriting a newer baseline', async () => {
      vi.useFakeTimers()
      try {
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('hello')))
        const { result } = renderSession()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })

        act(() => result.current.setDraft('a'))
        ipcMocks.request.mockResolvedValueOnce(writeResult(10, 1))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(800)
        })

        // Event with an unknown mtime triggers a read that comes back OLDER
        // than our baseline (a stale raceread) — the monotonic guard drops it.
        ipcMocks.request.mockClear()
        ipcMocks.request.mockResolvedValueOnce(readResult(utf8('ancient'), 5))
        await act(async () => {
          result.current.notifyExternalChange(50.5)
          await vi.advanceTimersByTimeAsync(0)
        })

        expect(result.current.savedContent).toBe('a')
        expect(result.current.draft).toBe('a')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('surfaces an unsupported status for oversize files', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(new Uint8Array(FILE_EDIT_MAX_SIZE_BYTES + 1)))
    const { result } = renderSession()
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.unsupportedReason).toBe('size')
  })

  it('surfaces an unsupported status for invalid UTF-8', async () => {
    // GBK bytes for "你好" are not valid UTF-8.
    ipcMocks.request.mockResolvedValueOnce(readResult(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])))
    const { result } = renderSession()
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.unsupportedReason).toBe('encoding')
  })

  it('surfaces an unsupported status for mixed line endings', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8('first\r\nsecond\n')))
    const { result } = renderSession()
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.unsupportedReason).toBe('mixed-line-endings')
  })
})
