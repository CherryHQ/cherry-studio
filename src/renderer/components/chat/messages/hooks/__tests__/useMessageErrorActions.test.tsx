import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import type { Message as SharedMessage } from '@shared/data/types/message'

import type { MessageListItem } from '../../types'
import { toMessageListItem } from '../../utils/messageListItem'

const mocks = vi.hoisted(() => ({
  translateErrorByAI: vi.fn(),
  diagnosisModuleEvaluated: vi.fn(),
  errorDetailModuleEvaluated: vi.fn(),
  showErrorDetailPopup: vi.fn()
}))

vi.mock('@renderer/utils/errorDiagnosis', () => {
  mocks.diagnosisModuleEvaluated()
  return { translateErrorByAI: mocks.translateErrorByAI }
})

vi.mock('@renderer/components/ErrorDetailModal', () => {
  mocks.errorDetailModuleEvaluated()
  return { showErrorDetailPopup: mocks.showErrorDetailPopup }
})

const { MESSAGE_FAULT_LIMIT, useMessageErrorActions } = await import('../useMessageErrorActions')
const modulesEvaluatedDuringHookImport = {
  diagnosis: mocks.diagnosisModuleEvaluated.mock.calls.length,
  errorDetail: mocks.errorDetailModuleEvaluated.mock.calls.length
}

describe('useMessageErrorActions', () => {
  beforeEach(() => {
    mocks.translateErrorByAI.mockReset()
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
    mocks.translateErrorByAI.mockResolvedValueOnce('服务商不可用')

    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    expect(modulesEvaluatedDuringHookImport).toEqual({ diagnosis: 0, errorDetail: 0 })

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error })
    expect(mocks.errorDetailModuleEvaluated).toHaveBeenCalledOnce()

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'zh-CN' })
    ).resolves.toBe('服务商不可用')
    expect(mocks.diagnosisModuleEvaluated).toHaveBeenCalledOnce()
    expect(mocks.errorDetailModuleEvaluated).toHaveBeenCalledOnce()
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
      persistedAt: '2026-01-02T03:04:05.000Z',
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

  it('records a provider-local model id that itself contains the separator', async () => {
    const message = {
      id: 'message-3',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error',
      modelId: 'custom::org::model'
    } satisfies MessageListItem
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    await result.current.openErrorDetail?.({
      message,
      partId: 'part-1',
      error: { message: 'failed', name: 'ProviderError', stack: '' }
    })

    expect(mocks.showErrorDetailPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        errorContext: expect.objectContaining({ providerId: 'custom', modelId: 'org::model' })
      })
    )
  })

  it('gives an identical failure after an in-place retry its own occurrence', async () => {
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '', statusCode: 503 }
    const persistedFailure = (updatedAt: string) =>
      toMessageListItem(
        sharedMessageToUIMessage({
          id: 'message-retry',
          topicId: 'topic-1',
          parentId: 'user-1',
          role: 'assistant',
          data: { parts: [{ type: 'data-error', data: error }] },
          searchableText: '',
          status: 'error',
          siblingsGroupId: 0,
          modelId: 'openai::gpt-4o',
          messageSnapshot: null,
          stats: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt
        } satisfies SharedMessage),
        { topicId: 'topic-1' }
      )
    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))
    const open = async (message: MessageListItem) => {
      await result.current.openErrorDetail?.({ message, partId: 'message-retry-part-0', error })
      return mocks.showErrorDetailPopup.mock.calls.at(-1)?.[0] as {
        errorContext: { id: string; occurredAt: string }
      }
    }

    const first = await open(persistedFailure('2026-01-01T00:01:00.000Z'))
    const reopened = await open(persistedFailure('2026-01-01T00:01:00.000Z'))
    const retried = await open(persistedFailure('2026-01-01T00:02:00.000Z'))

    expect(reopened.errorContext.id).toBe(first.errorContext.id)
    expect(retried.errorContext.id).not.toBe(first.errorContext.id)
    expect(retried.errorContext.occurredAt).toBe('2026-01-01T00:02:00.000Z')
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
