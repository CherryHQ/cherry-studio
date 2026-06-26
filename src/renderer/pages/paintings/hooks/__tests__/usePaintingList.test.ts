import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createPainting, updatePainting, refresh } = vi.hoisted(() => ({
  createPainting: vi.fn(),
  updatePainting: vi.fn(),
  refresh: vi.fn()
}))

vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({
    createPainting,
    updatePainting,
    deletePainting: vi.fn(),
    refresh
  })
}))

import { usePaintingList } from '../usePaintingList'

describe('usePaintingList create*', () => {
  beforeEach(() => {
    createPainting.mockReset().mockResolvedValue(undefined)
    updatePainting.mockReset().mockResolvedValue(undefined)
    refresh.mockReset().mockResolvedValue(undefined)
    window.modal = { error: vi.fn() } as unknown as typeof window.modal
    window.toast = { error: vi.fn(), warning: vi.fn() } as unknown as typeof window.toast
  })

  // A blank board carries no output and NO status — `null` status reads as an
  // empty board (the composer generates into it), not a failed run.
  it('createBoard creates an empty, statusless board at the given point', async () => {
    const { result } = renderHook(() => usePaintingList({ cancelGeneration: vi.fn() }))
    let id: string | undefined
    await act(async () => {
      id = await result.current.createBoard('openai', { x: 10, y: 20 })
    })

    expect(id).toBeTruthy()
    expect(createPainting).toHaveBeenCalledWith({
      id,
      providerId: 'openai',
      prompt: '',
      files: { output: [], input: [] },
      canvasX: 10,
      canvasY: 20
    })
    expect(createPainting.mock.calls[0][0]).not.toHaveProperty('status')
  })

  // An imported asset carries the file as output + `succeeded` so it renders like
  // any other image and can seed lineage.
  it('createAsset creates a succeeded source card carrying the file', async () => {
    const { result } = renderHook(() => usePaintingList({ cancelGeneration: vi.fn() }))
    let id: string | undefined
    await act(async () => {
      id = await result.current.createAsset('openai', 'file-1', { x: 0, y: 0 })
    })

    expect(createPainting).toHaveBeenCalledWith({
      id,
      providerId: 'openai',
      prompt: '',
      files: { output: ['file-1'], input: [] },
      status: 'succeeded',
      canvasX: 0,
      canvasY: 0
    })
  })

  it('returns undefined (and does not throw) when creation fails', async () => {
    createPainting.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => usePaintingList({ cancelGeneration: vi.fn() }))
    let id: string | undefined = 'sentinel'
    await act(async () => {
      id = await result.current.createBoard('openai', { x: 0, y: 0 })
    })

    expect(id).toBeUndefined()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ungroup clears the painting group_id', async () => {
    const { result } = renderHook(() => usePaintingList({ cancelGeneration: vi.fn() }))
    await act(async () => {
      await result.current.ungroup('p-1')
    })
    expect(updatePainting).toHaveBeenCalledWith('p-1', { groupId: null })
  })
})
