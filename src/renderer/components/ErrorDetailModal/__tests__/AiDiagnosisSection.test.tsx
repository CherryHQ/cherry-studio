import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  diagnoseError: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: mocks.get,
    patch: mocks.patch
  }
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

  it('persists Agent message diagnosis through the Agent-session endpoint', async () => {
    mocks.get.mockResolvedValue({
      data: {
        parts: [{ type: 'data-error', data: { name: 'AgentRuntimeError', message: 'failed' } }]
      }
    })

    render(
      <AiDiagnosisSection
        error={{ name: 'AgentRuntimeError', message: 'failed', stack: null }}
        status="loading"
        onStatusChange={vi.fn()}
        blockId="message-1-part-0"
        messageTopicId="agent-session:session-1"
      />
    )

    await waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith('/agent-sessions/session-1/messages/message-1', {
        body: {
          data: {
            parts: [
              expect.objectContaining({
                providerMetadata: expect.objectContaining({
                  cherry: expect.objectContaining({
                    diagnosis: expect.objectContaining({ summary: 'Runtime failed' })
                  })
                })
              })
            ]
          }
        }
      })
    })
    expect(mocks.get).toHaveBeenCalledWith('/agent-sessions/session-1/messages/message-1')
  })
})
