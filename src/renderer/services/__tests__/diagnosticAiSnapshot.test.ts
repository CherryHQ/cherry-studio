import { beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { AppErrorContext } from '@shared/types/appError'
import type { DoctorScopeKey, DoctorState } from '@shared/types/doctor'
import type { DoctorAgentIncident, DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentKey, doctorAgentStateCacheKey, doctorStateCacheKey } from '@shared/utils/doctor'
import { REDACTED } from '@shared/utils/redaction'

import { MockCacheUtils } from '../../../../tests/__mocks__/renderer/CacheService'
import { captureDiagnosticAiDiagnosis } from '../diagnosticAiSnapshot'

const REPORT_RUN_ID = 'report-1'
const SECRET = 'plain-secret-value-123456'
const TOKEN = `sk-proj-${'a'.repeat(24)}`
const CONCLUSION = 'Conclusion: the cached analysis is current.'

function completedDoctor(scope: DoctorScopeKey, runId = REPORT_RUN_ID): Extract<DoctorState, { status: 'completed' }> {
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
      scope,
      runId,
      tier: 'quick',
      selectedCheckIds: [],
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: '2026-05-01T00:00:01.000Z',
      expiresAt: '2026-05-01T00:10:01.000Z',
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: {},
        isPackaged: true,
        isPortable: false
      },
      results: [],
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

function agentState(input: {
  readonly scope: DoctorScopeKey
  readonly text: string
  readonly status?: 'running' | 'completed' | 'failed' | 'canceled'
  readonly reportRunId?: string
  readonly incident?: DoctorAgentIncident
  readonly runId?: string
  readonly modelId?: string
}): DoctorAgentState {
  const run = {
    runId: input.runId ?? 'agent-run-1',
    scope: input.scope,
    reportRunId: input.reportRunId ?? REPORT_RUN_ID,
    sessionId: 'session-1',
    modelId: input.modelId ?? 'openai::gpt-4o',
    startedAt: '2026-05-01T00:00:02.000Z',
    text: input.text,
    toolCalls: ['read_logs'],
    proposals: [],
    changes: [],
    ...(input.incident ? { incident: input.incident } : {})
  }
  if (input.status === 'failed') return { status: 'failed', error: 'the model stopped', ...run }
  return { status: input.status ?? 'completed', ...run }
}

function publish(scope: DoctorScopeKey, agent: DoctorAgentState, doctor: DoctorState = completedDoctor(scope)) {
  const incident = 'incident' in agent ? agent.incident : undefined
  cacheService.setShared(doctorStateCacheKey(scope), doctor)
  cacheService.setShared(doctorAgentStateCacheKey(doctorAgentKey(scope, incident)), agent)
}

const operationContext: AppErrorContext = {
  id: 'op-1',
  occurredAt: '2026-05-01T00:00:00.000Z',
  source: 'painting',
  operation: 'painting.generate',
  message: 'HTTP 500'
}

describe('captureDiagnosticAiDiagnosis', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('returns the current completed analysis with its real run metadata and redacted text', () => {
    const text = `api_key=${SECRET}\n${TOKEN}\n${CONCLUSION}`
    publish('global', agentState({ scope: 'global', text }))

    const captured = captureDiagnosticAiDiagnosis({ scope: 'global' })

    expect(captured?.text).toContain(CONCLUSION)
    expect(captured?.text).toContain(REDACTED)
    expect(captured?.text).not.toContain(SECRET)
    expect(captured?.text).not.toContain(TOKEN)
    expect(captured).toMatchObject({
      source: 'doctor-agent',
      status: 'completed',
      scope: 'global',
      runId: 'agent-run-1',
      reportRunId: REPORT_RUN_ID,
      modelId: 'openai::gpt-4o',
      startedAt: '2026-05-01T00:00:02.000Z'
    })
    expect(captured).not.toHaveProperty('toolCalls')
    expect(captured).not.toHaveProperty('errorId')
    expect(captured).not.toHaveProperty('topicId')
  })

  it('attaches an operation fault and a message fault only when the cached run is that fault', () => {
    const operation = { kind: 'operation', context: operationContext } as const
    publish(
      'operation:op-1',
      agentState({
        scope: 'operation:op-1',
        incident: operation,
        text: `api_key=${SECRET}\nOperation conclusion.`
      })
    )
    const message = { topicId: 'topic-1', messageId: 'message-1', errorId: 'err-1' }
    const messageContext: AppErrorContext = {
      ...operationContext,
      id: 'err-1',
      source: 'chat',
      operation: 'message.error'
    }
    publish(
      'chat:openai/gpt-4o',
      agentState({
        scope: 'chat:openai/gpt-4o',
        incident: message,
        text: 'Message conclusion.',
        status: 'failed',
        modelId: 'openai::gpt-4o-mini',
        runId: 'agent-run-message'
      })
    )

    expect(
      captureDiagnosticAiDiagnosis({
        scope: 'operation:op-1',
        incident: operation,
        errorContext: operationContext
      })
    ).toMatchObject({
      status: 'completed',
      errorId: 'op-1',
      text: expect.stringContaining('Operation conclusion.')
    })
    expect(
      captureDiagnosticAiDiagnosis({
        scope: 'chat:openai/gpt-4o',
        incident: message,
        errorContext: messageContext
      })
    ).toMatchObject({
      status: 'failed',
      errorId: 'err-1',
      topicId: 'topic-1',
      messageId: 'message-1',
      runId: 'agent-run-message',
      modelId: 'openai::gpt-4o-mini',
      text: 'Message conclusion.'
    })
    expect(
      captureDiagnosticAiDiagnosis({
        scope: 'chat:openai/gpt-4o',
        incident: message,
        errorContext: messageContext
      })?.text
    ).not.toContain(SECRET)
  })

  it('keeps a canceled run as canceled and ignores idle, running, empty, and stale runs', () => {
    publish('global', agentState({ scope: 'global', status: 'canceled', text: 'Stopped after the first check.' }))
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toMatchObject({
      status: 'canceled',
      text: 'Stopped after the first check.'
    })

    publish('global', agentState({ scope: 'global', text: CONCLUSION }), { status: 'idle' })
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()

    publish('global', agentState({ scope: 'global', text: CONCLUSION }), {
      status: 'running',
      runId: 'running-1',
      tier: 'quick',
      selectedCheckIds: [],
      startedAt: '2026-05-01T00:00:00.000Z',
      results: [],
      activeCheckIds: []
    })
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()

    publish('global', agentState({ scope: 'global', status: 'running', text: 'Still writing.' }))
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()

    publish('global', agentState({ scope: 'global', text: '   ' }))
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()

    publish('global', agentState({ scope: 'global', text: CONCLUSION, reportRunId: 'report-old' }))
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()

    publish('global', agentState({ scope: 'global', status: 'failed', text: '   ' }))
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toBeUndefined()
  })

  it('does not reuse another fault of the same message or an unrelated global analysis', () => {
    const scope = 'chat:openai/gpt-4o' as const
    const row = { topicId: 'topic-1', messageId: 'message-1' }
    publish(scope, agentState({ scope, incident: { ...row, errorId: 'err-1' }, text: 'First attempt.' }))
    publish('global', agentState({ scope: 'global', text: 'Unrelated global analysis.' }))
    cacheService.setShared(
      doctorAgentStateCacheKey(doctorAgentKey(scope, row)),
      agentState({ scope, incident: row, text: 'Legacy message analysis.' })
    )

    const firstContext: AppErrorContext = {
      ...operationContext,
      id: 'err-1',
      source: 'chat',
      operation: 'message.error'
    }
    const secondContext: AppErrorContext = { ...firstContext, id: 'err-2' }
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-2' }, errorContext: secondContext })
    ).toBeUndefined()
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-1' }, errorContext: firstContext })?.text
    ).toBe('First attempt.')
    expect(captureDiagnosticAiDiagnosis({ scope, incident: row })?.text).toBe('Legacy message analysis.')
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-1' }, errorContext: firstContext })?.text
    ).not.toContain('Unrelated')
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-1' }, errorContext: firstContext })?.text
    ).not.toContain('Legacy')

    publish(
      scope,
      agentState({ scope, incident: { ...row, errorId: 'err-2' }, text: 'Second attempt.', runId: 'agent-run-2' })
    )
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-2' }, errorContext: secondContext })
    ).toMatchObject({ text: 'Second attempt.', errorId: 'err-2', runId: 'agent-run-2' })
    expect(
      captureDiagnosticAiDiagnosis({ scope, incident: { ...row, errorId: 'err-1' }, errorContext: firstContext })?.text
    ).toBe('First attempt.')
  })

  it('does not attach a fault when the cached incident is a different one', () => {
    const scope = 'chat:openai/gpt-4o' as const
    const stored = { topicId: 'topic-1', messageId: 'message-1', errorId: 'err-1' }
    publish(scope, agentState({ scope, incident: stored, text: CONCLUSION }))
    const requested = { ...stored, errorId: 'err-9' }
    cacheService.setShared(
      doctorAgentStateCacheKey(doctorAgentKey(scope, requested)),
      agentState({ scope, incident: stored, text: CONCLUSION })
    )

    expect(
      captureDiagnosticAiDiagnosis({
        scope,
        incident: requested,
        errorContext: { ...operationContext, id: 'err-9', source: 'chat', operation: 'message.error' }
      })
    ).toBeUndefined()
  })

  it('leaves an already captured copy unchanged when the cache is replaced', () => {
    const agent = agentState({ scope: 'global', text: CONCLUSION })
    publish('global', agent)
    const captured = captureDiagnosticAiDiagnosis({ scope: 'global' })

    cacheService.setShared(
      doctorAgentStateCacheKey('global'),
      agentState({ scope: 'global', text: 'Replaced conclusion.', runId: 'agent-run-2' })
    )

    expect(captured?.text).toBe(CONCLUSION)
    expect(captured?.runId).toBe('agent-run-1')
    expect(captureDiagnosticAiDiagnosis({ scope: 'global' })).toMatchObject({
      text: 'Replaced conclusion.',
      runId: 'agent-run-2'
    })
    expect(captured).not.toBe(captureDiagnosticAiDiagnosis({ scope: 'global' }))
  })
})
