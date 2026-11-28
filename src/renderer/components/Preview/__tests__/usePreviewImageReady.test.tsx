import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'

import { usePreviewImageReady } from '../usePreviewImageReady'
it('keeps lazy PlantUML unavailable and binds reports to the active source', () => {
  const { result, rerender } = renderHook(({ source, required }) => usePreviewImageReady(source, required), {
    initialProps: { source: 'first', required: true }
  })
  expect(result.current.previewImageReady).toBe(false)
  act(() => result.current.onImageReadyChange(true))
  expect(result.current.previewImageReady).toBe(true)
  const obsolete = result.current.onImageReadyChange
  rerender({ source: 'second', required: true })
  expect(result.current.previewImageReady).toBe(false)
  act(() => result.current.onImageReadyChange(false))
  expect(result.current.previewImageReady).toBe(false)
  act(() => obsolete(true))
  expect(result.current.previewImageReady).toBe(false)
  rerender({ source: 'first', required: true })
  expect(result.current.previewImageReady).toBe(false)
})
it('preserves optional readiness for other preview types', () => {
  const { result } = renderHook(() => usePreviewImageReady('svg', false))
  expect(result.current.previewImageReady).toBeUndefined()
})
