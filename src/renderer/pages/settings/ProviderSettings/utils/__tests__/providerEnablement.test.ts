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

  it('enables a disabled provider with pin-to-top when at least one model is available', async () => {
    const enableProvider = vi.fn().mockResolvedValue(undefined)

    await enableProviderWhenModelsAvailable(disabledProvider, enableProvider, 2, 'test')

    expect(enableProvider).toHaveBeenCalledTimes(1)
  })

  it('skips when the provider is already enabled', async () => {
    const enableProvider = vi.fn().mockResolvedValue(undefined)

    await enableProviderWhenModelsAvailable(enabledProvider, enableProvider, 2, 'test')

    expect(enableProvider).not.toHaveBeenCalled()
  })

  it('skips when no models are available', async () => {
    const enableProvider = vi.fn().mockResolvedValue(undefined)

    await enableProviderWhenModelsAvailable(disabledProvider, enableProvider, 0, 'test')

    expect(enableProvider).not.toHaveBeenCalled()
  })

  it('skips when the provider has not resolved yet', async () => {
    const enableProvider = vi.fn().mockResolvedValue(undefined)

    await enableProviderWhenModelsAvailable(undefined, enableProvider, 2, 'test')

    expect(enableProvider).not.toHaveBeenCalled()
  })

  it('throws and logs when the atomic enable-and-pin action rejects', async () => {
    const enableError = new Error('enable and pin failed')
    const enableProvider = vi.fn().mockRejectedValue(enableError)

    await expect(enableProviderWhenModelsAvailable(disabledProvider, enableProvider, 2, 'test')).rejects.toBe(
      enableError
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider with pin-to-top when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: enableError })
    )
  })
})
