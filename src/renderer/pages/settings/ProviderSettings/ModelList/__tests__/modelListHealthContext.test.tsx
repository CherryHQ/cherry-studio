import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelListHealthProvider, useModelListHealthRun } from '../modelListHealthContext'

let setIsChecking!: (isChecking: boolean) => void
let setIsSingleChecking!: (isChecking: boolean) => void
const startHealthCheck = vi.fn()
const resetSingleModelResult = vi.fn()
const startSingleModelCheck = vi.fn()
const prepareCredentials = vi.fn()
const updateApiKey = vi.fn()
const emptyModels: never[] = []
const emptyApiKeyEntries: never[] = []
let initialSingleModelResult: ModelWithStatus | null = null
let latestRun!: ReturnType<typeof useModelListHealthRun>

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
      modelStatuses: [],
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

describe('ModelList health run coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
