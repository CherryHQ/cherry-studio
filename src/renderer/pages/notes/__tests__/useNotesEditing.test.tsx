import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { NoteRenameResult, NotesTreeNode } from '@renderer/types/note'
import { fetchNoteSummary } from '@renderer/utils/aiGeneration'

import { useNotesEditing } from '../hooks/useNotesEditing'

vi.mock('@renderer/utils/aiGeneration', () => ({ fetchNoteSummary: vi.fn() }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const note: NotesTreeNode = {
  id: '/notes/original.md',
  name: 'original',
  type: 'file',
  treePath: '/original',
  externalPath: '/notes/original.md',
  createdAt: '',
  updatedAt: ''
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchNoteSummary).mockResolvedValue('Roadmap')
  Object.assign(window, { api: { file: { readExternal: vi.fn().mockResolvedValue('note body') } } })
})

// Protect settled feedback, pending state, and the page's sole ownership of operation errors.
describe('useNotesEditing outcomes', () => {
  it.each([
    [{ ok: true, name: 'Roadmap' }, true, true],
    [{ ok: false, reason: 'exists' }, false, false],
    [{ ok: false, reason: 'failed' }, false, false],
    [{ ok: true, name: 'original' }, true, false]
  ] as const)('waits for the complete rename outcome %j', async (outcome, success, highlight) => {
    const pending = deferred<NoteRenameResult>()
    const onRenameNode = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useNotesEditing({ onRenameNode }))
    let operation!: Promise<void>
    await act(async () => {
      operation = result.current.handleAutoRename(note)
    })
    await waitFor(() => expect(onRenameNode).toHaveBeenCalledWith(note.id, 'Roadmap'))
    expect(result.current.renamingNodeIds.has(note.id)).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.newlyRenamedNodeIds.size).toBe(0)

    await act(async () => {
      pending.resolve(outcome)
      await operation
    })
    expect(result.current.renamingNodeIds.size).toBe(0)
    expect(result.current.newlyRenamedNodeIds.has(note.id)).toBe(highlight)
    expect(toast.success).toHaveBeenCalledTimes(success ? 1 : 0)
    if (success) expect(toast.success).toHaveBeenCalledWith('notes.auto_rename.success')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps the action pending through generation before rename begins', async () => {
    const generation = deferred<string | null>()
    vi.mocked(fetchNoteSummary).mockReturnValue(generation.promise)
    const onRenameNode = vi.fn().mockResolvedValue({ ok: true, name: 'Roadmap' })
    const { result } = renderHook(() => useNotesEditing({ onRenameNode }))
    let operation!: Promise<void>
    await act(async () => {
      operation = result.current.handleAutoRename(note)
    })
    expect(result.current.renamingNodeIds.has(note.id)).toBe(true)
    expect(onRenameNode).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => {
      generation.resolve('Roadmap')
      await operation
    })
    expect(result.current.renamingNodeIds.size).toBe(0)
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('notes.auto_rename.success')
  })

  it.each(['null', 'rejection', 'empty source'])('leaves the name unchanged for %s', async (failure) => {
    if (failure === 'null') vi.mocked(fetchNoteSummary).mockResolvedValue(null)
    if (failure === 'rejection') vi.mocked(fetchNoteSummary).mockRejectedValue(new Error('offline'))
    if (failure === 'empty source') vi.mocked(window.api.file.readExternal).mockResolvedValue('  ')
    const onRenameNode = vi.fn()
    const { result } = renderHook(() => useNotesEditing({ onRenameNode }))
    await act(async () => {
      await result.current.handleAutoRename(note)
    })
    expect(onRenameNode).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    if (failure === 'empty source') {
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith('notes.auto_rename.empty_note')
      expect(fetchNoteSummary).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    } else {
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('notes.auto_rename.failed')
    }
    expect(result.current.renamingNodeIds.size).toBe(0)
  })

  it.each([true, false])('manual save waits for the outcome (ok=%s) without duplicate errors', async (ok) => {
    const pending = deferred<NoteRenameResult>()
    const onRenameNode = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useNotesEditing({ onRenameNode }))
    act(() => result.current.handleStartEdit(note))
    act(() => result.current.inPlaceEdit.inputProps.onChange?.({ target: { value: 'Manual name' } } as never))
    let saving: unknown
    await act(async () => {
      saving = result.current.inPlaceEdit.saveEdit()
    })
    expect(result.current.inPlaceEdit.isSaving).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve(ok ? { ok: true, name: 'Manual name' } : { ok: false, reason: 'failed' })
      await saving
    })
    expect(result.current.inPlaceEdit.isSaving).toBe(false)
    expect(result.current.inPlaceEdit.isEditing).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(ok ? 1 : 0)
    if (ok) expect(toast.success).toHaveBeenCalledWith('common.saved')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
