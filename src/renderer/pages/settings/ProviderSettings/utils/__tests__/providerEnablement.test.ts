import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enableProviderWhenModelsAvailable } from '../providerEnablement'

const disabledProvider = { id: 'cherryin', isEnabled: false }
const enabledProvider = { id: 'cherryin', isEnabled: true }

describe('enableProviderWhenModelsAvailable', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
  })

  it('enables a disabled provider when at least one model is available and moves it to the top', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const moveProviderToFirst = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      moveProviderToFirst,
      2,
      'test'
    )

    expect(enabled).toBe(true)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(moveProviderToFirst).toHaveBeenCalledWith('cherryin')
  })

  it('no-ops when the provider is already enabled', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const moveProviderToFirst = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(
      enabledProvider,
      updateProvider,
      moveProviderToFirst,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('no-ops when no models are available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const moveProviderToFirst = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      moveProviderToFirst,
      0,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('no-ops when the provider has not resolved yet', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const moveProviderToFirst = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(undefined, updateProvider, moveProviderToFirst, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('returns false and logs without throwing when the update fails', async () => {
    const updateError = new Error('patch failed')
    const updateProvider = vi.fn().mockRejectedValue(updateError)
    const moveProviderToFirst = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      moveProviderToFirst,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(moveProviderToFirst).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: updateError })
    )
  })

  it('rolls back the enable state when moving the provider to the top fails', async () => {
    const moveError = new Error('move failed')
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const moveProviderToFirst = vi.fn().mockRejectedValue(moveError)

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      moveProviderToFirst,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenNthCalledWith(1, { isEnabled: true })
    expect(moveProviderToFirst).toHaveBeenCalledWith('cherryin')
    expect(updateProvider).toHaveBeenNthCalledWith(2, { isEnabled: false })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to move enabled provider to the top',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: moveError })
    )
  })
})
