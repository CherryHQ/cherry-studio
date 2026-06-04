import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEnableProviderWhenModelsAvailable } from '../useEnableProviderWhenModelsAvailable'

const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

const disabledProvider = { id: 'cherryin', isEnabled: false }
const enabledProvider = { id: 'cherryin', isEnabled: true }

describe('useEnableProviderWhenModelsAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to enable provider when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: updateError })
    )
  })
})
