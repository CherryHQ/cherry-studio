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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

const { cacheService } = await import('@data/CacheService')
const { useMessageErrorActions } = await import('../useMessageErrorActions')
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

    const { result } = renderHook(() => useMessageErrorActions())

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

    const { result } = renderHook(() => useMessageErrorActions())

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).rejects.toThrow('network')

    expect(cacheService.deleteCasual).toHaveBeenCalledWith('error.classify.provider unavailable:en-US')
    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).resolves.toBe('retry succeeded')
    expect(mocks.classifyErrorByAI).toHaveBeenCalledTimes(2)
  })

  it('forwards the injected diagnosis persistence capability to the popup', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'agent-session:session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'runtime failed', name: 'AgentRuntimeError', stack: '' }
    const diagnosticReport = { location: 'Agent conversation' }
    const persistDiagnosis = vi.fn()
    const { result } = renderHook(() => useMessageErrorActions({ diagnosticReport, persistDiagnosis }))

    await result.current.openErrorDetail?.({ message, partId: 'message-1-part-0', error })

    expect(mocks.showErrorDetailPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: 'message-1-part-0',
        diagnosticReport,
        error,
        onDiagnosisComplete: persistDiagnosis
      })
    )
  })
})
