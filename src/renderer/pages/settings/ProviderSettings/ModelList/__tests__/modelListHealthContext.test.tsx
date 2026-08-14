import { HealthStatus, type ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelList from '../ModelList'
import { ModelListHealthProvider, useModelListHealth, useModelListHealthRun } from '../modelListHealthContext'

const providerModelListRenderSpy = vi.fn()
const healthResultsRenderSpy = vi.fn()
let setIsChecking!: (isChecking: boolean) => void
let setIsSingleChecking!: (isChecking: boolean) => void
let setModelStatuses!: (statuses: ModelWithStatus[]) => void
const resetHealthCheckRun = vi.fn()
const startHealthCheck = vi.fn()
const resetSingleModelResult = vi.fn()
const startSingleModelCheck = vi.fn()
const updateApiKey = vi.fn()
const emptyModels: never[] = []
const emptyApiKeyEntries: never[] = []
let latestRun!: ReturnType<typeof useModelListHealthRun>

vi.mock('../useHealthCheck', () => ({
  useHealthCheck: () => {
    const [isChecking, updateIsChecking] = useState(false)
    const [modelStatuses, updateModelStatuses] = useState<ModelWithStatus[]>([])
    setIsChecking = updateIsChecking
    setModelStatuses = updateModelStatuses

    return {
      isChecking,
      modelStatuses,
      apiKeyEntries: [],
      requiresApiKey: true,
      resetHealthCheckRun,
      startHealthCheck
    }
  }
}))

vi.mock('../../hooks/providerSetting/useProviderConnectionCheck', () => ({
  useProviderConnectionCheck: () => {
    const [isSingleModelChecking, updateIsSingleModelChecking] = useState(false)
    setIsSingleChecking = updateIsSingleModelChecking
    return {
      models: emptyModels,
      apiKeyEntries: emptyApiKeyEntries,
      requiresApiKey: true,
      isSingleModelChecking,
      singleModelResult: null,
      resetSingleModelResult,
      startSingleModelCheck
    }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderMutations: () => ({ updateApiKey })
}))

vi.mock('../ProviderModelList', () => ({
  default: (props: unknown) => {
    providerModelListRenderSpy(props)
    return <div data-testid="provider-model-list-content" />
  }
}))

vi.mock('../ProviderModelPullReconcile', () => ({ default: () => null }))
vi.mock('../ProviderModelAdd', () => ({ default: () => null }))
vi.mock('../ProviderModelDownload', () => ({ default: () => null }))
vi.mock('../ProviderModelCheck', () => ({ default: () => null }))

function HealthResultsObserver() {
  const { modelStatuses } = useModelListHealth()
  healthResultsRenderSpy(modelStatuses)
  return null
}

function HealthRunObserver() {
  latestRun = useModelListHealthRun()
  return <div data-testid="dialog-state">{latestRun.modelCheckOpen ? 'open' : 'closed'}</div>
}

describe('ModelList health subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startSingleModelCheck.mockResolvedValue('failed')
    startHealthCheck.mockResolvedValue(true)
  })

  it('does not rerender the model list for per-model health result updates', () => {
    render(
      <ModelListHealthProvider providerId="openai">
        <ModelList providerId="openai" />
        <HealthResultsObserver />
      </ModelListHealthProvider>
    )

    expect(providerModelListRenderSpy).toHaveBeenCalledTimes(1)
    expect(healthResultsRenderSpy).toHaveBeenLastCalledWith([])

    act(() => {
      setModelStatuses([
        {
          kind: 'checking',
          model: {
            id: 'openai::gpt-4o',
            providerId: 'openai',
            name: 'GPT-4o',
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          },
          checking: true,
          status: HealthStatus.NOT_CHECKED,
          keyResults: []
        }
      ])
    })

    expect(providerModelListRenderSpy).toHaveBeenCalledTimes(1)
    expect(healthResultsRenderSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({ model: expect.objectContaining({ id: 'openai::gpt-4o' }) })
    ])

    act(() => {
      setIsChecking(true)
    })

    expect(providerModelListRenderSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps dialog visibility independent from runner cancellation and closes only on accepted outcomes', async () => {
    render(
      <ModelListHealthProvider providerId="openai">
        <HealthRunObserver />
      </ModelListHealthProvider>
    )

    act(() => latestRun.openModelCheck())
    expect(latestRun.modelCheckOpen).toBe(true)
    act(() => latestRun.closeModelCheck())
    expect(latestRun.modelCheckOpen).toBe(false)
    expect(resetSingleModelResult).not.toHaveBeenCalled()
    expect(resetHealthCheckRun).not.toHaveBeenCalled()

    act(() => latestRun.openModelCheck())
    await act(async () => {
      await latestRun.startSingleModelCheck({
        model: {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          name: 'GPT-4o',
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        },
        keySelection: { mode: 'all' }
      })
    })
    expect(latestRun.modelCheckOpen).toBe(true)

    startSingleModelCheck.mockResolvedValueOnce('passed')
    await act(async () => {
      await latestRun.startSingleModelCheck({
        model: {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          name: 'GPT-4o',
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        },
        keySelection: { mode: 'all' }
      })
    })
    expect(latestRun.modelCheckOpen).toBe(false)

    act(() => latestRun.openModelCheck())
    await act(async () => {
      await latestRun.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    expect(latestRun.modelCheckOpen).toBe(false)
  })

  it('prevents single-model and all-model runners from overlapping', async () => {
    render(
      <ModelListHealthProvider providerId="openai">
        <HealthRunObserver />
      </ModelListHealthProvider>
    )

    act(() => setIsChecking(true))
    await act(async () => {
      await latestRun.startSingleModelCheck({
        model: {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          name: 'GPT-4o',
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        },
        keySelection: { mode: 'all' }
      })
    })
    expect(startSingleModelCheck).not.toHaveBeenCalled()

    act(() => {
      setIsChecking(false)
      setIsSingleChecking(true)
    })
    await act(async () => {
      await latestRun.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    expect(startHealthCheck).not.toHaveBeenCalled()
    expect(latestRun.isModelChecking).toBe(true)
  })
})
