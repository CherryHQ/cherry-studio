// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: ipcMocks }))

import { UnsupportedArtifactFileEditError, useArtifactFileEditor } from '../useArtifactFileEditor'

const selection = { workspacePath: '/ws', filePath: 'notes.txt' }
const otherSelection = { workspacePath: '/ws', filePath: 'other.txt' }

const initialContent = 'hello\n'
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

function utf8(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

function withUtf8Bom(content: string): Uint8Array {
  const encoded = utf8(content)
  const result = new Uint8Array(UTF8_BOM.length + encoded.length)
  result.set(UTF8_BOM)
  result.set(encoded, UTF8_BOM.length)
  return result
}

function readResult(content: Uint8Array) {
  return { content, mime: 'text/plain', version: { mtime: 1, size: content.byteLength } }
}

beforeEach(() => ipcMocks.request.mockReset())

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useArtifactFileEditor', () => {
  it('enters edit mode by loading the file content', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())

    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.read', { kind: 'path', path: '/ws/notes.txt' })
    expect(result.current.getSession(selection)).toMatchObject({
      mode: 'edit',
      status: 'ready',
      draft: 'hello\n',
      savedContent: 'hello\n',
      lineEnding: 'lf',
      hasBom: false
    })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('saves a dirty draft with the version read from disk and records the new content', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'changed\n'))

    ipcMocks.request.mockResolvedValueOnce({ mtime: 2, size: 8 })
    await act(async () => {
      await result.current.save(selection)
    })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.write_if_unchanged', {
      handle: { kind: 'path', path: '/ws/notes.txt' },
      data: utf8('changed\n'),
      expectedVersion: { mtime: 1, size: utf8(initialContent).byteLength }
    })
    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'changed\n',
      savedContent: 'changed\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('uses the version returned by a successful save for the next save', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })

    act(() => result.current.updateDraft(selection, 'first save'))
    ipcMocks.request.mockResolvedValueOnce({ mtime: 2, size: 10 })
    await act(async () => {
      await result.current.save(selection)
    })

    act(() => result.current.updateDraft(selection, 'second save'))
    ipcMocks.request.mockResolvedValueOnce({ mtime: 3, size: 11 })
    await act(async () => {
      await result.current.save(selection)
    })

    const writeCalls = ipcMocks.request.mock.calls.filter(([route]) => route === 'file.write_if_unchanged')
    expect(writeCalls[1]?.[1]).toMatchObject({ expectedVersion: { mtime: 2, size: 10 } })
  })

  it('keeps the dirty draft ready for retry when saving fails', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const writeError = new Error('write failed')
    ipcMocks.request.mockRejectedValueOnce(writeError)
    await expect(
      act(async () => {
        await result.current.save(selection)
      })
    ).rejects.toBe(writeError)

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: 'draft',
      savedContent: 'hello\n'
    })
    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it('discard restores the last saved content', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    act(() => result.current.discard(selection))

    expect(result.current.getSession(selection)).toMatchObject({ draft: 'hello\n', savedContent: 'hello\n' })
  })

  it('reload replaces the draft with fresh file content', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    act(() => result.current.updateDraft(selection, 'draft'))

    const newer = 'newer\n'
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8(newer)))
    await act(async () => {
      await result.current.reload(selection)
    })

    expect(result.current.getSession(selection)).toMatchObject({
      status: 'ready',
      draft: newer,
      savedContent: newer
    })
  })

  it('replaces the active session when another file loads', async () => {
    ipcMocks.request.mockResolvedValue(readResult(utf8(initialContent)))
    const { result } = renderHook(() => useArtifactFileEditor())
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    await act(async () => {
      await result.current.setMode(otherSelection, 'edit')
    })
    expect(result.current.getSession(selection)).toBeUndefined()

    act(() => result.current.updateDraft(otherSelection, 'dirty'))
    expect(result.current.hasUnsavedChanges).toBe(true)
    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })
    expect(result.current.getSession(otherSelection)).toBeUndefined()
    expect(result.current.getSession(selection)).toMatchObject({ draft: 'hello\n' })
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('clears the active session and invalidates an outstanding load', async () => {
    let resolveLoad!: (value: ReturnType<typeof readResult>) => void
    ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let load: Promise<void> | undefined
    act(() => {
      load = result.current.setMode(selection, 'edit')
    })
    act(() => result.current.clear())
    await act(async () => {
      resolveLoad(readResult(utf8(initialContent)))
      await load
    })

    expect(result.current.getSession(selection)).toBeUndefined()
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('ignores a stale read response after a newer load starts', async () => {
    let resolveFirst!: (value: ReturnType<typeof readResult>) => void
    ipcMocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { result } = renderHook(() => useArtifactFileEditor())

    let first: Promise<void> | undefined
    act(() => {
      first = result.current.setMode(selection, 'edit')
    })
    ipcMocks.request.mockResolvedValueOnce(readResult(utf8('second\n')))
    await act(async () => {
      await result.current.reload(selection)
    })
    await act(async () => {
      resolveFirst(readResult(utf8('first\n')))
      await first
    })

    expect(result.current.getSession(selection)).toMatchObject({ status: 'ready', draft: 'second\n' })
  })

  it('drops the session and rethrows when the initial load fails', async () => {
    const readError = new Error('read failed')
    ipcMocks.request.mockRejectedValueOnce(readError)
    const { result } = renderHook(() => useArtifactFileEditor())

    await expect(
      act(async () => {
        await result.current.setMode(selection, 'edit')
      })
    ).rejects.toBe(readError)

    expect(result.current.getSession(selection)).toBeUndefined()
  })

  it('normalizes CRLF while editing and restores CRLF with the UTF-8 BOM on save', async () => {
    ipcMocks.request.mockResolvedValueOnce(readResult(withUtf8Bom('first\r\nsecond\r\n')))
    const { result } = renderHook(() => useArtifactFileEditor())

    await act(async () => {
      await result.current.setMode(selection, 'edit')
    })

    expect(result.current.getSession(selection)).toMatchObject({
      draft: 'first\nsecond\n',
      savedContent: 'first\nsecond\n',
      lineEnding: 'crlf',
      hasBom: true
    })

    act(() => result.current.updateDraft(selection, 'changed\ncontent\n'))
    ipcMocks.request.mockResolvedValueOnce({ mtime: 2, size: 22 })
    await act(async () => {
      await result.current.save(selection)
    })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.write_if_unchanged', {
      handle: { kind: 'path', path: '/ws/notes.txt' },
      data: withUtf8Bom('changed\r\ncontent\r\n'),
      expectedVersion: { mtime: 1, size: withUtf8Bom('first\r\nsecond\r\n').byteLength }
    })
  })

  it('keeps invalid UTF-8 and mixed-line-ending files preview-only', async () => {
    // GBK bytes for "你好" are not valid UTF-8.
    ipcMocks.request.mockResolvedValueOnce(readResult(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])))
    const { result } = renderHook(() => useArtifactFileEditor())

    await expect(
      act(async () => {
        await result.current.setMode(selection, 'edit')
      })
    ).rejects.toMatchObject({ reason: 'encoding' })
    expect(result.current.getSession(selection)).toBeUndefined()

    ipcMocks.request.mockResolvedValueOnce(readResult(utf8('first\r\nsecond\n')))
    await expect(
      act(async () => {
        await result.current.setMode(selection, 'edit')
      })
    ).rejects.toBeInstanceOf(UnsupportedArtifactFileEditError)
    expect(result.current.getSession(selection)).toBeUndefined()
    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.write_if_unchanged', expect.anything())
  })
})
