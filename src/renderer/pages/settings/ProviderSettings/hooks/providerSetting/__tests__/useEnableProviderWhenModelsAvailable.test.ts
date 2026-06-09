import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEnableProviderWhenModelsAvailable } from '../useEnableProviderWhenModelsAvailable'

const disabledProvider = { id: 'cherryin', isEnabled: false }
const enabledProvider = { id: 'cherryin', isEnabled: true }

describe('useEnableProviderWhenModelsAvailable', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
  })

  it('enables a disabled provider when at least one model is available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(2)
    })

    expect(enabled).toBe(true)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
  })

  it('no-ops when the provider is already enabled', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: enabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(2)
    })

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('no-ops when no models are available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(0)
    })

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('no-ops for undefined, NaN, and negative model counts', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    await act(async () => {
      // A non-array `.length` would surface here as undefined; `undefined <= 0`
      // is false, so the helper must reject it via `!(modelCount > 0)`.
      expect(await result.current(undefined as unknown as number)).toBe(false)
      expect(await result.current(Number.NaN)).toBe(false)
      expect(await result.current(-1)).toBe(false)
    })

    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('dedupes concurrent in-flight calls into a single update', async () => {
    let resolveUpdate: (() => void) | undefined
    const updateProvider = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve
      })
    )
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    let firstEnabled: boolean | undefined
    let secondEnabled: boolean | undefined
    await act(async () => {
      const first = result.current(2)
      const second = result.current(2)
      resolveUpdate?.()
      firstEnabled = await first
      secondEnabled = await second
    })

    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(firstEnabled).toBe(true)
    expect(secondEnabled).toBe(false)
  })

  it('no-ops when the provider has not resolved yet', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: undefined,
        updateProvider,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(2)
    })

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('no-ops when no updateProvider is supplied', async () => {
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider: undefined,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(2)
    })

    expect(enabled).toBe(false)
  })

  it('returns false and logs without throwing when the update fails', async () => {
    const updateError = new Error('patch failed')
    const updateProvider = vi.fn().mockRejectedValue(updateError)
    const { result } = renderHook(() =>
      useEnableProviderWhenModelsAvailable({
        providerId: 'cherryin',
        provider: disabledProvider,
        updateProvider,
        source: 'test'
      })
    )

    let enabled: boolean | undefined
    await act(async () => {
      enabled = await result.current(2)
    })

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: updateError })
    )
  })
})
