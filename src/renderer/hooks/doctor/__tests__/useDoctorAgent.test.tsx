import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { DoctorAgentIncident, DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentKey, doctorAgentStateCacheKey } from '@shared/utils/doctor'

const request = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => request(...args) }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key
  })
}))

import { useDoctorAgent } from '../useDoctorAgent'

function analysis(status: 'running' | 'completed'): DoctorAgentState {
  return {
    status,
    runId: 'run-1',
    scope: 'global',
    reportRunId: 'report-1',
    sessionId: 'session-1',
    modelId: 'openai::gpt-5',
    startedAt: '2026-10-15T00:00:00.000Z',
    text: '',
    toolCalls: [],
    proposals: [],
    changes: []
  }
}

function seedAnalysis(status: 'running' | 'completed', incident?: DoctorAgentIncident) {
  MockUseCacheUtils.setSharedCacheValue(doctorAgentStateCacheKey(doctorAgentKey('global', incident)), analysis(status))
}

describe('useDoctorAgent', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    request.mockReset()
    request.mockResolvedValue({ status: 'started', runId: 'run-1' })
  })

  it('keeps a rejected start in the panel and clears it when the next start succeeds', async () => {
    request.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useDoctorAgent({ scope: 'global', reportRunId: 'report-1' }))

    await act(async () => result.current.start('openai::gpt-5'))

    expect(result.current.actionError).toBe('settings.doctor.agent.messages.start_failed')
    expect(result.current.busy).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => result.current.start('openai::gpt-5'))

    expect(result.current.actionError).toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps a cancel failure while the analysis is still running', async () => {
    seedAnalysis('running')
    request.mockRejectedValueOnce(new Error('cancel failed'))
    const { result } = renderHook(() => useDoctorAgent({ scope: 'global', reportRunId: 'report-1' }))

    await act(async () => result.current.cancel())

    expect(result.current.actionError).toBe('settings.doctor.messages.cancel_failed')
    expect(result.current.busy).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('diagnostics.doctor.agent.cancel', { key: 'global', runId: 'run-1' })
  })

  it('keeps a failed apply in the panel, including the backend message, and clears it when apply succeeds', async () => {
    seedAnalysis('completed')
    request.mockResolvedValueOnce({ status: 'failed', message: 'disk full' }).mockResolvedValueOnce({
      status: 'applied',
      change: { id: 'change-1' }
    })
    const { result } = renderHook(() => useDoctorAgent({ scope: 'global', reportRunId: 'report-1' }))

    await act(async () => result.current.apply('proposal-1'))

    expect(result.current.actionError).toBe('settings.doctor.agent.messages.apply_failed:message=disk full')
    expect(result.current.busy).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()

    await act(async () => result.current.apply('proposal-1'))

    expect(result.current.actionError).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('settings.doctor.agent.messages.applied')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not carry a failure onto a different incident', async () => {
    request.mockRejectedValueOnce(new Error('offline'))
    const { result, rerender } = renderHook(
      ({ errorId }: { errorId: string }) =>
        useDoctorAgent({
          scope: 'global',
          reportRunId: 'report-1',
          incident: { topicId: 'topic-1', messageId: 'msg-1', errorId }
        }),
      { initialProps: { errorId: 'err-a' } }
    )

    await act(async () => result.current.start('openai::gpt-5'))
    expect(result.current.actionError).toBe('settings.doctor.agent.messages.start_failed')

    rerender({ errorId: 'err-b' })

    expect(result.current.actionError).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
