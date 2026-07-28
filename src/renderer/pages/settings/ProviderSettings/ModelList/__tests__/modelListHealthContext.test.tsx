import { HealthStatus, type ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelList from '../ModelList'
import { ModelListHealthProvider, useModelListHealth } from '../modelListHealthContext'

const providerModelListRenderSpy = vi.fn()
const healthResultsRenderSpy = vi.fn()
const runControls = {
  availableApiKeys: [],
  healthCheckOpen: false,
  openHealthCheck: vi.fn(),
  closeHealthCheck: vi.fn(),
  resetHealthCheckRun: vi.fn(),
  startHealthCheck: vi.fn()
}

let setIsChecking!: (isChecking: boolean) => void
let setModelStatuses!: (statuses: ModelWithStatus[]) => void

vi.mock('../useHealthCheck', () => ({
  useHealthCheck: () => {
    const [isChecking, updateIsChecking] = useState(false)
    const [modelStatuses, updateModelStatuses] = useState<ModelWithStatus[]>([])
    setIsChecking = updateIsChecking
    setModelStatuses = updateModelStatuses

    return { isChecking, modelStatuses, ...runControls }
  }
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
vi.mock('../ProviderModelHealthCheck', () => ({ default: () => null }))

function HealthResultsObserver() {
  const { modelStatuses } = useModelListHealth()
  healthResultsRenderSpy(modelStatuses)
  return null
}

describe('ModelList health subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
