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
    const enableProviderAndMoveToFirst = vi.fn().mockResolvedValue(undefined)

    const result = await enableProviderWhenModelsAvailable(disabledProvider, enableProviderAndMoveToFirst, 2, 'test')

    expect(result).toEqual({ status: 'enabled' })
    expect(enableProviderAndMoveToFirst).toHaveBeenCalledTimes(1)
  })

  it('skips when the provider is already enabled', async () => {
    const enableProviderAndMoveToFirst = vi.fn().mockResolvedValue(undefined)

    const result = await enableProviderWhenModelsAvailable(enabledProvider, enableProviderAndMoveToFirst, 2, 'test')

    expect(result).toEqual({ status: 'skipped', reason: 'already_enabled' })
    expect(enableProviderAndMoveToFirst).not.toHaveBeenCalled()
  })

  it('skips when no models are available', async () => {
    const enableProviderAndMoveToFirst = vi.fn().mockResolvedValue(undefined)

    const result = await enableProviderWhenModelsAvailable(disabledProvider, enableProviderAndMoveToFirst, 0, 'test')

    expect(result).toEqual({ status: 'skipped', reason: 'no_models' })
    expect(enableProviderAndMoveToFirst).not.toHaveBeenCalled()
  })

  it('skips when the provider has not resolved yet', async () => {
    const enableProviderAndMoveToFirst = vi.fn().mockResolvedValue(undefined)

    const result = await enableProviderWhenModelsAvailable(undefined, enableProviderAndMoveToFirst, 2, 'test')

    expect(result).toEqual({ status: 'skipped', reason: 'missing_provider' })
    expect(enableProviderAndMoveToFirst).not.toHaveBeenCalled()
  })

  it('returns failed and logs when the atomic enable-and-pin action rejects', async () => {
    const enableError = new Error('enable and pin failed')
    const enableProviderAndMoveToFirst = vi.fn().mockRejectedValue(enableError)

    const result = await enableProviderWhenModelsAvailable(disabledProvider, enableProviderAndMoveToFirst, 2, 'test')

    expect(result).toEqual({ status: 'failed', error: enableError })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider with pin-to-top when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: enableError })
    )
  })
})
