import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, expect, it, vi } from 'vitest'

import { useImageGenerationSupport } from '../useImageGenerationSupport'

function wrapper({ children }: PropsWithChildren) {
  return createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
}

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.mocked(window.api.ipcApi.request).mockReset()
})

it('updates the effective input capability after a registry update', async () => {
  let files = true
  vi.mocked(window.api.ipcApi.request).mockImplementation(async () => ({
    ok: true,
    data: { modes: { generate: { supports: {} } }, inputCapabilities: { files } }
  }))
  const { result } = renderHook(() => useImageGenerationSupport('openai', 'gpt-image-1'), { wrapper })
  await waitFor(() => expect(result.current?.inputCapabilities.files).toBe(true))
  files = false
  act(() =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/providers/:providerId/models/:modelId*/image-generation-support' }
    ])
  )
  await waitFor(() => expect(result.current?.inputCapabilities.files).toBe(false))
})

it('does not reuse image support from the previous model while a new model resolves', async () => {
  let finish: ((value: unknown) => void) | undefined
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => {
    if ((input as { uniqueModelId: string }).uniqueModelId.endsWith('::new')) {
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    return { ok: true, data: { modes: {}, inputCapabilities: { files: true } } }
  })
  const { result, rerender } = renderHook(({ model }) => useImageGenerationSupport('openai', model), {
    wrapper,
    initialProps: { model: 'old' }
  })
  await waitFor(() => expect(result.current?.inputCapabilities.files).toBe(true))
  rerender({ model: 'new' })
  expect(result.current).toBeUndefined()
  await act(async () => finish?.({ ok: true, data: { modes: {}, inputCapabilities: { files: false } } }))
  await waitFor(() => expect(result.current?.inputCapabilities.files).toBe(false))
})
