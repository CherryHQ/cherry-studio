import { HealthStatus, type ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelHealthStatusStore } from '../ModelHealthStatusStore'
import { ModelListHealthProvider, useModelHealthStatus, useModelListHealthRun } from '../modelListHealthContext'

let setIsChecking!: (isChecking: boolean) => void
let setIsSingleChecking!: (isChecking: boolean) => void
let statusStore: ModelHealthStatusStore
const startHealthCheck = vi.fn()
const resetSingleModelResult = vi.fn()
const startSingleModelCheck = vi.fn()
const prepareCredentials = vi.fn()
const updateApiKey = vi.fn()
const emptyModels: never[] = []
const emptyApiKeyEntries: never[] = []
let initialSingleModelResult: ModelWithStatus | null = null
let latestRun!: ReturnType<typeof useModelListHealthRun>

const alphaModel: Model = {
  id: 'openai::alpha',
  providerId: 'openai',
  name: 'Alpha',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const betaModel: Model = { ...alphaModel, id: 'openai::beta', name: 'Beta' }
const initialStatuses: ModelWithStatus[] = [alphaModel, betaModel].map((model) => ({
  kind: 'checking',
  model,
  checking: true,
  status: HealthStatus.NOT_CHECKED,
  keyResults: []
}))

vi.mock('../../hooks/providerSetting/useModelCheckCredentials', () => ({
  useModelCheckCredentials: () => ({
    apiKeyEntries: emptyApiKeyEntries,
    canSelectApiKey: true,
    requiresApiKey: true,
    credentialChangeVersion: 0,
    prepareCredentials
  })
}))

vi.mock('../useHealthCheck', () => ({
  useHealthCheck: () => {
    const [isChecking, updateIsChecking] = useState(false)
    setIsChecking = updateIsChecking

    return {
      isChecking,
      statusStore,
      startHealthCheck
    }
  }
}))

vi.mock('../../hooks/providerSetting/useProviderConnectionCheck', () => ({
  useProviderConnectionCheck: () => {
    const [isSingleModelChecking, updateIsSingleModelChecking] = useState(false)
    const [singleModelResult, setSingleModelResult] = useState(initialSingleModelResult)
    setIsSingleChecking = updateIsSingleModelChecking
    return {
      models: emptyModels,
      isSingleModelChecking,
      singleModelResult,
      resetSingleModelResult: () => {
        resetSingleModelResult()
        setSingleModelResult(null)
      },
      startSingleModelCheck
    }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderMutations: () => ({ updateApiKey })
}))

function HealthRunObserver() {
  latestRun = useModelListHealthRun()
  return (
    <div>
      <span data-testid="dialog-state">{latestRun.modelCheckOpen ? 'open' : 'closed'}</span>
      <span data-testid="single-result">{latestRun.singleModelResult?.kind ?? 'none'}</span>
    </div>
  )
}

function HealthStatusObserver({ modelId }: { modelId: UniqueModelId }) {
  const renderCount = useRef(0)
  const modelStatus = useModelHealthStatus(modelId)
  renderCount.current += 1

  return (
    <div data-testid={`${modelId}-status`}>
      {modelStatus?.kind ?? 'none'}:{renderCount.current}
    </div>
  )
}

describe('ModelList health run coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statusStore = new ModelHealthStatusStore()
    statusStore.replaceStatuses(initialStatuses)
    initialSingleModelResult = null
    startSingleModelCheck.mockResolvedValue('failed')
    startHealthCheck.mockResolvedValue(true)
  })

  it('keeps dialog visibility independent from runner cancellation and closes only on accepted outcomes', async () => {
    render(
      <ModelListHealthProvider providerId="openai">
        <HealthRunObserver />
      </ModelListHealthProvider>
    )

    act(() => latestRun.openModelCheck())
    expect(latestRun.canSelectApiKey).toBe(true)
    expect(latestRun.modelCheckOpen).toBe(true)
    act(() => latestRun.closeModelCheck())
    expect(latestRun.modelCheckOpen).toBe(false)

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
    startHealthCheck.mockResolvedValueOnce(false)
    await act(async () => {
      await latestRun.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    expect(latestRun.modelCheckOpen).toBe(true)

    startHealthCheck.mockResolvedValueOnce(true)
    await act(async () => {
      await latestRun.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    expect(latestRun.modelCheckOpen).toBe(false)
  })

  it('clears a prior single-model result when reopening the dialog', () => {
    initialSingleModelResult = {
      kind: 'failed',
      model: {
        id: 'openai::gpt-4o',
        providerId: 'openai',
        name: 'GPT-4o',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      keyResults: [],
      status: HealthStatus.FAILED,
      checking: false,
      error: { name: 'ProviderError', message: 'Unauthorized', stack: null }
    }

    render(
      <ModelListHealthProvider providerId="openai">
        <HealthRunObserver />
      </ModelListHealthProvider>
    )

    expect(screen.getByTestId('single-result')).toHaveTextContent('failed')
    act(() => latestRun.openModelCheck())
    expect(screen.getByTestId('single-result')).toHaveTextContent('none')
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

  it('does not invalidate an unrelated model row when one health result changes', () => {
    render(
      <ModelListHealthProvider providerId="openai">
        <HealthStatusObserver modelId={alphaModel.id} />
        <HealthStatusObserver modelId={betaModel.id} />
      </ModelListHealthProvider>
    )

    expect(screen.getByTestId(`${betaModel.id}-status`)).toHaveTextContent('checking:1')

    act(() => {
      statusStore.setStatus({
        kind: 'ok',
        model: alphaModel,
        checking: false,
        status: HealthStatus.SUCCESS,
        latency: 12,
        keyResults: []
      })
    })

    expect(screen.getByTestId(`${alphaModel.id}-status`)).toHaveTextContent('ok:2')
    expect(screen.getByTestId(`${betaModel.id}-status`)).toHaveTextContent('checking:1')
  })
})
