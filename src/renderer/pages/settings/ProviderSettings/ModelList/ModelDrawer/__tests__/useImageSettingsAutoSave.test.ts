import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ImageGenerationConfigSchema } from '@shared/ai/imageGenerationConfig'

import { useImageSettingsAutoSave } from '../useImageSettingsAutoSave'

const config = (quality: string) => ImageGenerationConfigSchema.parse({ generate: { defaults: { quality } } })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('image settings autosave', () => {
  it('does not write initial or invalid drafts and skips duplicate updates', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const { rerender } = renderHook(
      ({ value, enabled }) => useImageSettingsAutoSave(value, enabled, persist, onError),
      { initialProps: { value: config('low'), enabled: false } }
    )
    expect(persist).not.toHaveBeenCalled()
    rerender({ value: config('high'), enabled: true })
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    rerender({ value: config('high'), enabled: true })
    expect(persist).toHaveBeenCalledTimes(1)
  })
  it('serializes writes and retains the latest queued edit after closing the drawer', async () => {
    const first = deferred()
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const { rerender, unmount } = renderHook(({ value }) => useImageSettingsAutoSave(value, true, persist, vi.fn()), {
      initialProps: { value: config('low') }
    })
    rerender({ value: config('medium') })
    rerender({ value: config('high') })
    expect(persist).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => {
      first.resolve()
      await first.promise
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1][0]).toEqual(config('high'))
  })
  it('reports a failed write and allows retrying the current value', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const onError = vi.fn()
    const { result } = renderHook(() => useImageSettingsAutoSave(config('high'), true, persist, onError))
    await waitFor(() => expect(result.current.error).toBe('disk full'))
    expect(onError).toHaveBeenCalledTimes(1)
    await act(async () => result.current.retry())
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(persist).toHaveBeenCalledTimes(2)
  })
})
