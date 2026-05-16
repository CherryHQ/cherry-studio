import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHealthCheck } from '../useHealthCheck'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderApiKeysMock = vi.fn()

const checkModelsHealthMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth', () => ({
  checkModelsHealth: (...args: any[]) => checkModelsHealthMock(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

describe('useHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      error: vi.fn(),
      success: vi.fn()
    }
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
    useModelsMock.mockReturnValue({
      models: [
        { id: 'openai::gpt-4o', providerId: 'openai', name: 'GPT-4o', capabilities: [] },
        { id: 'openai::gpt-3.5', providerId: 'openai', name: 'GPT-3.5', capabilities: [] }
      ]
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'k1', key: 'sk-a', isEnabled: true }] }
    })
  })

  it('aborts the in-flight run and clears state when providerId changes', async () => {
    // T4: pin the abort + runId staleness contract — switching providers
    // mid-check must drop the in-flight callback before it touches state.
    let resolveCheck: (() => void) | undefined
    const onCheckedRef: { current?: (result: any, index: number) => void } = {}
    checkModelsHealthMock.mockImplementation(async (_options, onChecked) => {
      onCheckedRef.current = onChecked
      await new Promise<void>((resolve) => {
        resolveCheck = resolve
      })
    })

    const { result, rerender } = renderHook(({ providerId }) => useHealthCheck(providerId), {
      initialProps: { providerId: 'openai' }
    })

    await act(async () => {
      void result.current.startHealthCheck({ apiKeys: ['sk-a'], isConcurrent: false, timeout: 5000 })
      await Promise.resolve()
    })
    expect(result.current.isChecking).toBe(true)
    expect(result.current.modelStatuses.length).toBe(2)

    rerender({ providerId: 'anthropic' })

    // Switching provider aborts the previous run; modelStatuses + isChecking are cleared.
    expect(result.current.isChecking).toBe(false)
    expect(result.current.modelStatuses).toEqual([])

    // Late onChecked from the aborted run must NOT land on the new mount.
    act(() => {
      onCheckedRef.current?.({ kind: 'ok', model: { id: 'openai::gpt-4o' }, status: 'success' } as any, 0)
    })
    expect(result.current.modelStatuses).toEqual([])

    resolveCheck?.()
  })

  it('closeHealthCheck aborts the controller and increments runIdRef to drop late callbacks', async () => {
    let onCheckedHandler: ((result: any, index: number) => void) | undefined
    let abortSignalCaptured: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(async (options, onChecked) => {
      onCheckedHandler = onChecked
      abortSignalCaptured = options.signal
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    })

    const { result } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      void result.current.startHealthCheck({ apiKeys: ['sk-a'], isConcurrent: false, timeout: 5000 })
      await Promise.resolve()
    })

    expect(result.current.isChecking).toBe(true)

    act(() => {
      result.current.closeHealthCheck()
    })

    expect(abortSignalCaptured?.aborted).toBe(true)
    expect(result.current.isChecking).toBe(false)
    expect(result.current.healthCheckOpen).toBe(false)

    // Late callback should not mutate modelStatuses since runId bumped on close.
    const statusesBefore = result.current.modelStatuses
    act(() => {
      onCheckedHandler?.({ kind: 'ok', model: { id: 'openai::gpt-4o' }, status: 'success' } as any, 0)
    })
    expect(result.current.modelStatuses).toBe(statusesBefore)
  })

  it('unmount aborts the in-flight controller', async () => {
    let abortSignal: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(async (options) => {
      abortSignal = options.signal
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    })

    const { result, unmount } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      void result.current.startHealthCheck({ apiKeys: ['sk-a'], isConcurrent: false, timeout: 5000 })
      await Promise.resolve()
    })

    expect(abortSignal?.aborted).toBe(false)
    unmount()
    await waitFor(() => expect(abortSignal?.aborted).toBe(true))
  })
})
