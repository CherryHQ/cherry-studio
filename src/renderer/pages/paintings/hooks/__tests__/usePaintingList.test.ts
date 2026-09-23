import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingList } from '../usePaintingList'

const boundary = vi.hoisted(() => ({
  remove: vi.fn(),
  select: vi.fn(),
  error: vi.fn(),
  restore: vi.fn(),
  undo: vi.fn(),
  cancelProject: vi.fn()
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: boundary.cancelProject } }))
vi.mock('@renderer/services/recycleBinFeedback', () => ({ showRecycleBinUndo: boundary.undo }))
vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({
    deletePainting: boundary.remove,
    restorePainting: boundary.restore,
    selectPainting: boundary.select,
    refresh: async () => {}
  })
}))
vi.mock('../../errors/paintingGenerateError', () => ({ presentPaintingGenerateError: boundary.error }))
const root: PaintingData = {
  id: 'root',
  providerId: 'test',
  mode: 'generate',
  prompt: '',
  files: [],
  persistedAt: '2026-01-01T00:00:00.000Z'
}
function setup() {
  const change = vi.fn()
  const hook = renderHook(() =>
    usePaintingList({
      painting: { ...root, id: 'step', projectId: 'root' },
      setCurrentPainting: change,
      draftDefaults: { providerId: 'test' },
      historyItems: [root],
      cancelGeneration: vi.fn()
    })
  )
  return { ...hook, change }
}
beforeEach(() => {
  vi.clearAllMocks()
  boundary.remove.mockResolvedValue(undefined)
  boundary.select.mockResolvedValue(undefined)
  boundary.cancelProject.mockResolvedValue(undefined)
})
describe('painting projects', () => {
  it('awaits durable project cancellation before deleting its versions', async () => {
    let finish!: () => void
    boundary.cancelProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const { result } = setup()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.remove(root)
    })
    expect(boundary.cancelProject).toHaveBeenCalledWith('ai.image.cancel_project', { projectId: 'root' })
    expect(boundary.remove).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await pending
    })
    expect(boundary.remove).toHaveBeenCalledWith('root')
  })

  it('preserves the project when durable cancellation fails', async () => {
    boundary.cancelProject.mockRejectedValue(new Error('cancel failed'))
    const { result, change } = setup()
    await act(async () => {
      await result.current.remove(root)
    })
    expect(boundary.remove).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    expect(boundary.error.mock.calls[0][0].message).toBe('cancel failed')
  })
  it('starts a separate draft without overwriting the selected historical step', async () => {
    const { result, change } = setup()
    await act(async () => {
      await result.current.add()
    })
    expect(change.mock.calls[0][0]).toMatchObject({ files: [], prompt: '' })
    expect(change.mock.calls[0][0].projectId).toBeUndefined()
  })
  it('returns to a draft after deleting the project containing the selected step', async () => {
    const { result, change } = setup()
    await act(async () => {
      await result.current.remove(root)
    })
    expect(boundary.remove).toHaveBeenCalledWith('root')
    expect(change.mock.calls[0][0].persistedAt).toBeUndefined()
  })
  it('restores the project root when undoing deletion from a selected version', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.remove(root)
    })
    const undo = boundary.undo.mock.calls[0][0].onUndo
    await act(async () => {
      await undo()
    })
    expect(boundary.restore).toHaveBeenCalledWith('root')
  })
  it('keeps the selected version when project deletion fails', async () => {
    boundary.remove.mockRejectedValue(new Error('database unavailable'))
    const { result, change } = setup()
    await act(async () => {
      await result.current.remove(root)
    })
    expect(change).not.toHaveBeenCalled()
    expect(boundary.error).toHaveBeenCalled()
  })
})
