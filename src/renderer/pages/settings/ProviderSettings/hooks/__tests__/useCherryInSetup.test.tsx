import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { Model } from '@shared/data/types/model'

import { useCherryInSetup } from '../useCherryInSetup'

const syncProviderModelsMock = vi.fn()
const models: Model[] = [
  {
    id: 'cherryin::gpt-4o-mini',
    providerId: 'cherryin',
    name: 'GPT-4o mini',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
]
const initializeOfficialAssistantsMock = vi.mocked(dataApiService.post)

vi.mock('../useProviderModelSync', () => ({
  useProviderModelSync: () => ({ syncProviderModels: syncProviderModelsMock })
}))

describe('useCherryInSetup', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    syncProviderModelsMock.mockReset().mockResolvedValue(models)
    initializeOfficialAssistantsMock.mockResolvedValue(undefined)
  })

  it('returns synced models only after official assistant initialization completes', async () => {
    let finishInitialization!: () => void
    MockDataApiUtils.setCustomResponse(
      '/assistants:initialize-cherryin-official',
      'POST',
      new Promise<void>((resolve) => {
        finishInitialization = resolve
      })
    )
    const { result } = renderHook(() => useCherryInSetup('cherryin'))
    let completed = false
    let setup!: Promise<Model[] | undefined>

    await act(async () => {
      setup = result.current.completeSetup(() => true)
      void setup.then(() => {
        completed = true
      })
    })

    expect(initializeOfficialAssistantsMock).toHaveBeenCalledWith('/assistants:initialize-cherryin-official', {
      body: {}
    })
    expect(completed).toBe(false)
    await act(async () => {
      finishInitialization()
    })
    await expect(setup).resolves.toEqual(models)
  })

  it('propagates model sync failure without creating official assistants', async () => {
    const error = new Error('model sync failed')
    syncProviderModelsMock.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useCherryInSetup('cherryin'))

    await act(async () => {
      await expect(result.current.completeSetup(() => true)).rejects.toBe(error)
    })
    expect(initializeOfficialAssistantsMock).not.toHaveBeenCalled()
  })

  it('preserves synced models when official assistant initialization fails', async () => {
    initializeOfficialAssistantsMock.mockRejectedValueOnce(new Error('initialization failed'))
    const { result } = renderHook(() => useCherryInSetup('cherryin'))

    await act(async () => {
      await expect(result.current.completeSetup(() => true)).resolves.toEqual(models)
    })
  })

  it('does not create official assistants when the login becomes stale during model sync', async () => {
    let finishSync!: (models: Model[]) => void
    syncProviderModelsMock.mockImplementationOnce(
      () =>
        new Promise<Model[]>((resolve) => {
          finishSync = resolve
        })
    )
    let current = true
    const { result } = renderHook(() => useCherryInSetup('cherryin'))
    let setup!: Promise<Model[] | undefined>

    await act(async () => {
      setup = result.current.completeSetup(() => current)
    })
    current = false
    await act(async () => {
      finishSync(models)
    })

    await expect(setup).resolves.toBeUndefined()
    expect(initializeOfficialAssistantsMock).not.toHaveBeenCalled()
  })

  it('discards completed initialization when a newer login takes over', async () => {
    let finishInitialization!: () => void
    MockDataApiUtils.setCustomResponse(
      '/assistants:initialize-cherryin-official',
      'POST',
      new Promise<void>((resolve) => {
        finishInitialization = resolve
      })
    )
    let current = true
    const { result } = renderHook(() => useCherryInSetup('cherryin'))
    let setup!: Promise<Model[] | undefined>

    await act(async () => {
      setup = result.current.completeSetup(() => current)
    })
    current = false
    await act(async () => {
      finishInitialization()
    })

    await expect(setup).resolves.toBeUndefined()
  })

  it('discards a stale model sync failure instead of reporting it for a newer login', async () => {
    let failSync!: (error: Error) => void
    syncProviderModelsMock.mockImplementationOnce(
      () =>
        new Promise<Model[]>((_resolve, reject) => {
          failSync = reject
        })
    )
    let current = true
    const { result } = renderHook(() => useCherryInSetup('cherryin'))
    let setup!: Promise<Model[] | undefined>

    await act(async () => {
      setup = result.current.completeSetup(() => current)
    })
    current = false
    await act(async () => {
      failSync(new Error('stale model sync failed'))
    })

    await expect(setup).resolves.toBeUndefined()
    expect(initializeOfficialAssistantsMock).not.toHaveBeenCalled()
  })
})
