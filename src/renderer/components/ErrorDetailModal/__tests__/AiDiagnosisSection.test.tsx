import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

const { default: AiDiagnosisSection } = await import('../AiDiagnosisSection')

describe('AiDiagnosisSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.diagnoseError.mockResolvedValue({
      summary: 'Runtime failed',
      category: 'runtime',
      explanation: 'Check the provider',
      steps: []
    })
  })

  it('delegates diagnosis persistence to the injected capability', async () => {
    const onDiagnosisComplete = vi.fn()

    render(
      <AiDiagnosisSection
        error={{ name: 'AgentRuntimeError', message: 'failed', stack: null }}
        status="loading"
        onStatusChange={vi.fn()}
        blockId="message-1-part-0"
        onDiagnosisComplete={onDiagnosisComplete}
      />
    )

    await waitFor(() => {
      expect(onDiagnosisComplete).toHaveBeenCalledWith(
        'message-1-part-0',
        expect.objectContaining({ summary: 'Runtime failed' })
      )
    })
  })

  it('keeps a completed diagnosis visible when persistence fails', async () => {
    const onStatusChange = vi.fn()

    render(
      <AiDiagnosisSection
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
        status="loading"
        onStatusChange={onStatusChange}
        blockId="message-1-part-0"
        onDiagnosisComplete={() => {
          throw new Error('write failed')
        }}
      />
    )

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('done'))
    expect(onStatusChange).not.toHaveBeenCalledWith('error')
  })
})
