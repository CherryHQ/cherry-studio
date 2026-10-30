import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  classifyErrorByAI: vi.fn(),
  diagnosisModuleEvaluated: vi.fn(),
  errorDetailModuleEvaluated: vi.fn(),
  showErrorDetailPopup: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    deleteCasual: vi.fn((key: string) => mocks.cache.delete(key)),
    getCasual: vi.fn((key: string) => mocks.cache.get(key)),
    setCasual: vi.fn((key: string, value: unknown) => {
      mocks.cache.set(key, value)
      return true
    })
  }
}))

vi.mock('@renderer/utils/errorDiagnosis', () => {
  mocks.diagnosisModuleEvaluated()
  return { classifyErrorByAI: mocks.classifyErrorByAI }
})

vi.mock('@renderer/components/ErrorDetailModal', () => {
  mocks.errorDetailModuleEvaluated()
  return { showErrorDetailPopup: mocks.showErrorDetailPopup }
})

const { cacheService } = await import('@data/CacheService')
const { MESSAGE_FAULT_LIMIT, useMessageErrorActions } = await import('../useMessageErrorActions')
const modulesEvaluatedDuringHookImport = {
  diagnosis: mocks.diagnosisModuleEvaluated.mock.calls.length,
  errorDetail: mocks.errorDetailModuleEvaluated.mock.calls.length
}

describe('useMessageErrorActions', () => {
  beforeEach(() => {
    mocks.cache.clear()
    mocks.classifyErrorByAI.mockReset()
    mocks.showErrorDetailPopup.mockReset()
    vi.clearAllMocks()
  })

  it('loads hook action implementations only when invoked', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '' }
    mocks.classifyErrorByAI.mockResolvedValueOnce('AI summary')

    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    expect(modulesEvaluatedDuringHookImport).toEqual({ diagnosis: 0, errorDetail: 0 })

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error })
    expect(mocks.errorDetailModuleEvaluated).toHaveBeenCalledOnce()

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).resolves.toBe('AI summary')
    expect(mocks.diagnosisModuleEvaluated).toHaveBeenCalledOnce()
    expect(mocks.errorDetailModuleEvaluated).toHaveBeenCalledOnce()
  })

  it('evicts failed AI diagnosis promises so transient failures can retry', async () => {
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '' }
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    mocks.classifyErrorByAI.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('retry succeeded')

    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).rejects.toThrow('network')

    expect(cacheService.deleteCasual).toHaveBeenCalledWith('error.classify.ProviderError:provider unavailable:en-US')
    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).resolves.toBe('retry succeeded')
    expect(mocks.classifyErrorByAI).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a classification cached for a different error name', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const providerError = { message: 'provider unavailable', name: 'ProviderError', stack: '' }
    const abortError = { message: 'provider unavailable', name: 'AbortError', stack: '' }
    mocks.classifyErrorByAI.mockResolvedValueOnce('provider summary').mockResolvedValueOnce('abort summary')
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error: providerError, language: 'en-US' })
    ).resolves.toBe('provider summary')
    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error: abortError, language: 'en-US' })
    ).resolves.toBe('abort summary')
    expect(mocks.classifyErrorByAI).toHaveBeenCalledTimes(2)
  })

  it('projects a visible summary as an error-summary for that fault without inventing a run', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '' }
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error, aiSummary: 'Visible conclusion.' })

    const handoff = mocks.showErrorDetailPopup.mock.calls[0]?.[0] as {
      aiDiagnosis?: {
        errorId?: string
        modelId?: string
        runId?: string
        source?: string
        status?: string
        text?: string
      }
      errorContext: { id: string }
    }
    expect(handoff.aiDiagnosis).toEqual({
      source: 'error-summary',
      status: 'completed',
      text: 'Visible conclusion.',
      errorId: handoff.errorContext.id
    })
    expect(handoff.aiDiagnosis).not.toHaveProperty('modelId')
    expect(handoff.aiDiagnosis).not.toHaveProperty('runId')
    expect(handoff.aiDiagnosis).not.toHaveProperty('reportRunId')
  })

  it('keeps the Agent identity when its runtime error has no model fields', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'agent-session:session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = {
      message: 'runtime failed',
      name: 'AgentRuntimeError',
      stack: '',
      statusCode: 503,
      responseBody: '{"error":"runtime"}'
    }
    const diagnosticReport = { location: 'Agent conversation' }
    const getDoctorSubject = () => ({ kind: 'agent' as const, agentId: 'agent-1' })
    const { result } = renderHook(() => useMessageErrorActions({ diagnosticReport, getDoctorSubject }))

    await result.current.openErrorDetail?.({ message, partId: 'message-1-part-0', error })

    expect(mocks.showErrorDetailPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'agent', agentId: 'agent-1' },
        incident: {
          topicId: 'agent-session:session-1',
          messageId: 'message-1',
          errorId: expect.any(String)
        },
        diagnosticReport,
        error,
        errorContext: expect.objectContaining({
          source: 'agent',
          operation: 'message.error',
          recordId: 'message-1',
          message: 'runtime failed',
          name: 'AgentRuntimeError',
          occurredAt: '2026-01-02T03:04:05.000Z',
          statusCode: 503,
          responseBody: '{"error":"runtime"}',
          params: { partId: 'message-1-part-0', topicId: 'agent-session:session-1' }
        })
      })
    )
    const first = mocks.showErrorDetailPopup.mock.calls[0]?.[0] as {
      errorContext: { id: string; occurredAt: string }
      incident: { errorId: string }
    }
    expect(first.incident.errorId).toBe(first.errorContext.id)
    await result.current.openErrorDetail?.({ message, partId: 'message-1-part-0', error })
    const second = mocks.showErrorDetailPopup.mock.calls[1]?.[0] as {
      errorContext: { id: string; occurredAt: string }
      incident: { errorId: string }
    }
    expect(second.errorContext.id).toBe(first.errorContext.id)
    expect(second.incident.errorId).toBe(first.errorContext.id)
    expect(second.errorContext.occurredAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('uses the doctor subject when it disagrees with the topic id prefix', async () => {
    const message = {
      id: 'message-2',
      role: 'assistant',
      topicId: 'agent-session:session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'chat failed', name: 'ProviderError', stack: '' }
    const { result } = renderHook(() =>
      useMessageErrorActions({ getDoctorSubject: () => ({ kind: 'chat', providerId: 'openai', modelId: 'chat' }) })
    )

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error })

    expect(mocks.showErrorDetailPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        errorContext: expect.objectContaining({ source: 'chat', operation: 'message.error' })
      })
    )
  })

  it('gives a new failure of the same message its own snapshot', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const firstError = {
      message: 'provider unavailable',
      name: 'ProviderError',
      stack: '',
      statusCode: 503,
      responseBody: '{"error":"first"}'
    }
    const nextError = { ...firstError, responseBody: '{"error":"second"}', statusCode: 429 }
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error: firstError })
    const first = mocks.showErrorDetailPopup.mock.calls[0]?.[0] as {
      errorContext: { id: string }
      incident: { errorId: string }
    }
    await result.current.openErrorDetail?.({ message, partId: 'part-1', error: nextError })
    const second = mocks.showErrorDetailPopup.mock.calls[1]?.[0] as {
      errorContext: { id: string; responseBody?: string; statusCode?: number }
      incident: { errorId: string }
    }

    expect(first.incident.errorId).toBe(first.errorContext.id)
    expect(second.incident.errorId).toBe(second.errorContext.id)
    expect(second.errorContext.id).not.toBe(first.errorContext.id)
    expect(second.incident.errorId).not.toBe(first.incident.errorId)
    expect(second.errorContext.statusCode).toBe(429)
    expect(second.errorContext.responseBody).toBe('{"error":"second"}')
  })

  it('drops the oldest message fault once the snapshot map is full', async () => {
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))
    const open = (id: string) =>
      result.current.openErrorDetail?.({
        message: {
          id,
          role: 'assistant',
          topicId: 'topic-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'error'
        },
        partId: 'part-1',
        error: { message: 'provider unavailable', name: 'ProviderError', stack: '' }
      })

    for (let index = 0; index < MESSAGE_FAULT_LIMIT; index += 1) {
      await open(`message-${index}`)
    }
    const oldest = mocks.showErrorDetailPopup.mock.calls[0]?.[0] as { errorContext: { id: string } }
    const newest = mocks.showErrorDetailPopup.mock.calls[MESSAGE_FAULT_LIMIT - 1]?.[0] as {
      errorContext: { id: string }
    }
    await open('message-overflow')
    mocks.showErrorDetailPopup.mockClear()

    await open('message-0')
    const reopenedOldest = mocks.showErrorDetailPopup.mock.calls[0]?.[0] as { errorContext: { id: string } }
    expect(reopenedOldest.errorContext.id).not.toBe(oldest.errorContext.id)

    await open(`message-${MESSAGE_FAULT_LIMIT - 1}`)
    const reopenedNewest = mocks.showErrorDetailPopup.mock.calls[1]?.[0] as { errorContext: { id: string } }
    expect(reopenedNewest.errorContext.id).toBe(newest.errorContext.id)
  })
})
