import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'
const reset = vi.hoisted(() => vi.fn())
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('../../utils/computeModelFieldReset', () => ({ computeModelFieldReset: reset }))
vi.mock('../../errors/paintingGenerateError', () => ({ presentPaintingGenerateError: vi.fn() }))
const painting = {
  id: 'project',
  providerId: 'relay',
  model: 'old',
  mode: 'generate',
  prompt: '',
  files: [],
  params: {}
} as PaintingData
function deferred() {
  let resolve!: (v: Record<string, unknown>) => void
  const promise = new Promise<Record<string, unknown>>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
describe('model switch ordering', () => {
  it('keeps the last selected model when earlier metadata resolves late', async () => {
    const first = deferred()
    const second = deferred()
    reset.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let current = painting
    const onPaintingChange = (patch: Partial<PaintingData>) => {
      current = { ...current, ...patch }
    }
    const { result } = renderHook(() =>
      usePaintingModelSwitch({ painting, onPaintingChange, ensureProviderCatalog: async () => [] })
    )
    let one!: Promise<void>
    let two!: Promise<void>
    act(() => {
      one = result.current({ providerId: 'relay', modelId: 'first' })
      two = result.current({ providerId: 'relay', modelId: 'last' })
    })
    await act(async () => {
      second.resolve({ resolution: '2K' })
      await two
    })
    await act(async () => {
      first.resolve({ resolution: '4K' })
      await one
    })
    expect(current.model).toBe('last')
    expect(current.params).toEqual({ resolution: '2K' })
  })
  it('does not apply pending choices to another painting', async () => {
    const pending = deferred()
    reset.mockReset().mockReturnValue(pending.promise)
    const update = vi.fn()
    const { result, rerender } = renderHook(
      ({ painting }) =>
        usePaintingModelSwitch({ painting, onPaintingChange: update, ensureProviderCatalog: async () => [] }),
      { initialProps: { painting } }
    )
    let task!: Promise<void>
    act(() => {
      task = result.current({ providerId: 'relay', modelId: 'next' })
    })
    rerender({ painting: { ...painting, id: 'another' } })
    await act(async () => {
      pending.resolve({})
      await task
    })
    expect(update).not.toHaveBeenCalled()
  })
})
