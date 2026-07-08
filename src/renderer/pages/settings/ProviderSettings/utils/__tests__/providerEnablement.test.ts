import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enableProviderWhenModelsAvailable } from '../providerEnablement'

const disabledProvider = { id: 'cherryin', isEnabled: false }
const enabledProvider = { id: 'cherryin', isEnabled: true }
const createProviderReorder = ({
  assertCanMoveProviderToFirst = vi.fn(),
  moveProviderToFirst = vi.fn().mockResolvedValue(undefined)
}: {
  assertCanMoveProviderToFirst?: ReturnType<typeof vi.fn>
  moveProviderToFirst?: ReturnType<typeof vi.fn>
} = {}) => ({
  assertCanMoveProviderToFirst,
  moveProviderToFirst
})

describe('enableProviderWhenModelsAvailable', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
  })

  it('enables a disabled provider when at least one model is available and moves it to the top', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder()

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      providerReorder,
      2,
      'test'
    )

    expect(enabled).toBe(true)
    expect(providerReorder.assertCanMoveProviderToFirst).toHaveBeenCalledBefore(updateProvider)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(providerReorder.moveProviderToFirst).toHaveBeenCalledWith('cherryin')
  })

  it('no-ops when the provider is already enabled', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder()

    const enabled = await enableProviderWhenModelsAvailable(enabledProvider, updateProvider, providerReorder, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(providerReorder.assertCanMoveProviderToFirst).not.toHaveBeenCalled()
    expect(providerReorder.moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('no-ops when no models are available', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder()

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      providerReorder,
      0,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(providerReorder.assertCanMoveProviderToFirst).not.toHaveBeenCalled()
    expect(providerReorder.moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('no-ops when the provider has not resolved yet', async () => {
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder()

    const enabled = await enableProviderWhenModelsAvailable(undefined, updateProvider, providerReorder, 2, 'test')

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(providerReorder.assertCanMoveProviderToFirst).not.toHaveBeenCalled()
    expect(providerReorder.moveProviderToFirst).not.toHaveBeenCalled()
  })

  it('returns false without enabling when provider list reorder is not ready', async () => {
    const reorderError = new Error('provider list cache is not ready')
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder({
      assertCanMoveProviderToFirst: vi.fn(() => {
        throw reorderError
      })
    })

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      providerReorder,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).not.toHaveBeenCalled()
    expect(providerReorder.moveProviderToFirst).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Provider list is not ready for enabling with pin-to-top',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: reorderError })
    )
  })

  it('returns false and logs without throwing when the update fails', async () => {
    const updateError = new Error('patch failed')
    const updateProvider = vi.fn().mockRejectedValue(updateError)
    const providerReorder = createProviderReorder()

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      providerReorder,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenCalledWith({ isEnabled: true })
    expect(providerReorder.moveProviderToFirst).not.toHaveBeenCalled()
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to enable provider when models are available',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: updateError })
    )
  })

  it('rolls back the enable state when moving the provider to the top fails', async () => {
    const moveError = new Error('move failed')
    const updateProvider = vi.fn().mockResolvedValue(undefined)
    const providerReorder = createProviderReorder({
      moveProviderToFirst: vi.fn().mockRejectedValue(moveError)
    })

    const enabled = await enableProviderWhenModelsAvailable(
      disabledProvider,
      updateProvider,
      providerReorder,
      2,
      'test'
    )

    expect(enabled).toBe(false)
    expect(updateProvider).toHaveBeenCalledTimes(2)
    expect(updateProvider).toHaveBeenNthCalledWith(1, { isEnabled: true })
    expect(providerReorder.moveProviderToFirst).toHaveBeenCalledWith('cherryin')
    expect(updateProvider).toHaveBeenNthCalledWith(2, { isEnabled: false })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to move enabled provider to the top',
      expect.objectContaining({ providerId: 'cherryin', modelCount: 2, source: 'test', error: moveError })
    )
  })
})
