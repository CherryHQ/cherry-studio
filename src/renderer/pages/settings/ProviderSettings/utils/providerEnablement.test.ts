import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enableProviderWhenModelsAvailable } from './providerEnablement'

const disabledProvider = { id: 'cherryin', isEnabled: false }
const enabledProvider = { id: 'cherryin', isEnabled: true }

describe('enableProviderWhenModelsAvailable', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
  })

  it('enables a disabled provider when at least one model is available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(disabledProvider, updateProvider, 2, 'test')

    expect(enabled).toBe(true)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
  })

  it('no-ops when the provider is already enabled', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(enabledProvider, updateProvider, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('no-ops when no models are available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(disabledProvider, updateProvider, 0, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('no-ops when the provider has not resolved yet', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)

    const enabled = await enableProviderWhenModelsAvailable(undefined, updateProvider, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
  })

  it('returns false and logs without throwing when the update fails', async () => {
    const updateError = new Error('patch failed')
    const updateProvider = vi.fn().mockRejectedValue(updateError)

    const enabled = await enableProviderWhenModelsAvailable(disabledProvider, updateProvider, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: updateError })
    )
  })
})
