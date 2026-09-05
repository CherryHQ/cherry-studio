import { HealthStatus, type ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearModelHealthStatus, useModelHealthStatus, writeModelHealthStatus } from '../modelHealthStatusCache'

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

function checkingStatus(model: Model): ModelWithStatus {
  return { kind: 'checking', model, checking: true, status: HealthStatus.NOT_CHECKED, keyResults: [] }
}

function okStatus(model: Model): ModelWithStatus {
  return { kind: 'ok', model, checking: false, status: HealthStatus.SUCCESS, latency: 12, keyResults: [] }
}

function StatusObserver({ modelId }: { modelId: UniqueModelId }) {
  const renderCount = useRef(0)
  const modelStatus = useModelHealthStatus(modelId)
  renderCount.current += 1

  return (
    <div data-testid={`${modelId}-status`}>
      {modelStatus?.kind ?? 'none'}:{renderCount.current}
    </div>
  )
}

describe('model health status cache', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('does not invalidate an unrelated model row when one health result changes', () => {
    writeModelHealthStatus(checkingStatus(alphaModel))
    writeModelHealthStatus(checkingStatus(betaModel))

    render(
      <>
        <StatusObserver modelId={alphaModel.id} />
        <StatusObserver modelId={betaModel.id} />
      </>
    )

    expect(screen.getByTestId(`${betaModel.id}-status`)).toHaveTextContent('checking:1')

    act(() => writeModelHealthStatus(okStatus(alphaModel)))

    expect(screen.getByTestId(`${alphaModel.id}-status`)).toHaveTextContent('ok:2')
    expect(screen.getByTestId(`${betaModel.id}-status`)).toHaveTextContent('checking:1')
  })

  it('drops the row status when a model result is cleared', () => {
    writeModelHealthStatus(okStatus(alphaModel))
    render(<StatusObserver modelId={alphaModel.id} />)

    act(() => clearModelHealthStatus(alphaModel.id))

    expect(screen.getByTestId(`${alphaModel.id}-status`)).toHaveTextContent('none:2')
  })
})
