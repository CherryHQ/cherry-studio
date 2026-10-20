import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

const doctorAgent = vi.hoisted(() => ({ checkModel: vi.fn(), start: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ DoctorAgentService: doctorAgent } as never)
})

import { doctorAgentHandlers } from '../doctorAgent'

const ctx = { senderId: 'main' }

beforeEach(() => vi.clearAllMocks())

describe('doctorAgentHandlers', () => {
  it('preserves an authentication failure for the renderer', async () => {
    doctorAgent.checkModel.mockRejectedValue(
      new APICallError({
        message: '',
        url: 'https://api.example.com/chat',
        requestBodyValues: {},
        statusCode: 401,
        responseHeaders: {},
        responseBody: '',
        isRetryable: false
      })
    )

    const error = await doctorAgentHandlers['diagnostics.doctor.agent.check_model'](
      { modelId: 'openai::gpt-5' },
      ctx
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.data).toMatchObject({
      name: 'AI_APICallError',
      providerErrorCategory: 'auth',
      statusCode: 401
    })
  })

  it('preserves an authentication failure when starting an analysis', async () => {
    doctorAgent.start.mockRejectedValue(
      new APICallError({
        message: '',
        url: 'https://api.example.com/chat',
        requestBodyValues: {},
        statusCode: 401,
        responseHeaders: {},
        responseBody: '',
        isRetryable: false
      })
    )

    const error = await doctorAgentHandlers['diagnostics.doctor.agent.start'](
      { scope: 'global', reportRunId: 'report-1' },
      ctx
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.data).toMatchObject({
      name: 'AI_APICallError',
      providerErrorCategory: 'auth',
      statusCode: 401
    })
  })
})
