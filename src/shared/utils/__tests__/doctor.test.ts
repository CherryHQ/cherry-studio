import { describe, expect, it } from 'vitest'

import { doctorRequestSchemas } from '../../ipc/schemas/doctor'
import { doctorAgentRequestSchemas } from '../../ipc/schemas/doctorAgent'
import { DOCTOR_CHECK_CATALOG, type DoctorCheckId, type DoctorReport } from '../../types/doctor'
import {
  doctorAgentKey,
  doctorProposalFailureDetail,
  doctorRunFailureDetail,
  doctorScopeKey,
  doctorStateCacheKey,
  isDoctorFixRequest,
  isDoctorScopeKey,
  isOperationIncident,
  projectDoctorReport
} from '../doctor'

describe('DOCTOR_CHECK_CATALOG', () => {
  it('has no prerequisite cycles', () => {
    const visiting = new Set<DoctorCheckId>()
    const done = new Set<DoctorCheckId>()
    const visit = (id: DoctorCheckId): void => {
      if (done.has(id)) return
      if (visiting.has(id)) throw new Error(`cycle through ${id}`)
      visiting.add(id)
      for (const dep of DOCTOR_CHECK_CATALOG[id].requires) visit(dep)
      visiting.delete(id)
      done.add(id)
    }
    for (const id of Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]) expect(() => visit(id)).not.toThrow()
  })
})

describe('isDoctorFixRequest', () => {
  const valid = { scope: 'global' as const, runId: 'run-1', checkId: 'config-boot-config-valid', fixId: 'repair' }
  it('requires targets only for targeted fixes and rejects retired destructive fixes', () => {
    expect(isDoctorFixRequest({ ...valid, target: 'unexpected' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, target: undefined })).toBe(false)
    expect(isDoctorFixRequest({ runId: 'r', checkId: 'mcp-servers-connected', fixId: 'restart' })).toBe(false)
    expect(isDoctorFixRequest({ runId: 'r', checkId: 'storage-disk-space', fixId: 'cleanup' })).toBe(false)
    expect(isDoctorFixRequest({ runId: 'r', checkId: 'storage-diagnostic-data-size', fixId: 'clear' })).toBe(false)
    expect(isDoctorFixRequest({ runId: 'r', checkId: 'config-hardware-acceleration', fixId: 'enable' })).toBe(false)
  })

  it('accepts a fix the catalog declares for that check, bound to a run', () => {
    expect(isDoctorFixRequest(valid)).toBe(true)
    expect(
      isDoctorFixRequest({
        scope: 'global',
        runId: 'run-1',
        checkId: 'mcp-servers-connected',
        fixId: 'restart',
        target: 'server-1'
      })
    ).toBe(true)
  })

  it('rejects a declared fix id aimed at a check that does not offer it', () => {
    expect(isDoctorFixRequest({ ...valid, checkId: 'storage-userdata-location' })).toBe(false)
  })

  it('rejects requests without a run identity, unknown checks and malformed payloads', () => {
    expect(isDoctorFixRequest({ checkId: valid.checkId, fixId: valid.fixId })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, scope: undefined })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, scope: 'elsewhere' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, runId: '' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, checkId: 'nope' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, target: '' })).toBe(false)
    expect(isDoctorFixRequest({ ...valid, target: 1 })).toBe(false)
    expect(isDoctorFixRequest(null)).toBe(false)
    expect(isDoctorFixRequest('config-boot-config-valid')).toBe(false)
  })
})

describe('projectDoctorReport', () => {
  const report: DoctorReport = {
    schemaVersion: 1,
    scope: 'global',
    runId: 'run-1',
    tier: 'quick',
    selectedCheckIds: ['config-boot-config-valid', 'logs-recent-findings'],
    startedAt: '2026-09-04T00:00:00.000Z',
    finishedAt: '2026-09-04T00:00:01.000Z',
    expiresAt: '2026-09-04T00:10:01.000Z',
    basics: {
      version: '2.0.0',
      edition: 'global',
      channel: 'latest',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25.5.0',
      runtime: { electron: '41.8.0' },
      isPackaged: true,
      isPortable: false,
      userDataPath: '/Users/alice/Library/Application Support/CherryStudio'
    },
    results: [
      {
        id: 'storage-userdata-location',
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: 'fallback_to_default' },
        actions: [{ kind: 'open_path', path: '/Users/alice/private-action' }],
        durationMs: 1,
        devMessage: 'developer trace at /Users/alice/private.log',
        evidence: [
          { key: 'errno', value: 'EACCES', dataClass: 'public' },
          { key: 'path', value: '/Users/alice/...', dataClass: 'local_only' },
          { key: 'stderr', value: 'raw output', dataClass: 'consent_required' }
        ]
      },
      {
        id: 'runtime-managed-tools',
        status: 'error',
        durationMs: 2,
        message: 'spawn failed at /Users/alice/private-runtime'
      }
    ],
    summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 1 }
  }
  it('keeps confirmation prompts local and removes executable request IDs from every export', () => {
    const pendingChecks = [
      {
        checkId: 'provider-model-conversation' as const,
        requestId: 'private-request',
        confirmation: {
          messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation' as const,
          params: { model: 'Private model', endpoint: 'http://private-gateway' }
        }
      }
    ]
    const pending = { ...report, pendingChecks }
    expect(projectDoctorReport(pending, 'display').pendingChecks).toEqual(pendingChecks)
    for (const view of ['copy', 'export', 'upload'] as const) {
      expect(projectDoctorReport(pending, view, { consentToSensitive: true })).not.toHaveProperty('pendingChecks')
    }
  })

  const classes = (view: Parameters<typeof projectDoctorReport>[1], consent = false) =>
    projectDoctorReport(report, view, { consentToSensitive: consent }).results[0].evidence?.map((e) => e.dataClass)

  it('keeps only public data in the copy view, even with consent', () => {
    const copy = projectDoctorReport(report, 'copy', { consentToSensitive: true })
    expect(copy.basics.userDataPath).toBeUndefined()
    expect(classes('copy', true)).toEqual(['public'])
  })

  it('keeps local-only data in export and adds consent-required only on opt-in', () => {
    expect(projectDoctorReport(report, 'export').basics.userDataPath).toBeDefined()
    expect(classes('export')).toEqual(['public', 'local_only'])
    expect(classes('export', true)).toEqual(['public', 'local_only', 'consent_required'])
  })

  it('strips local paths from upload but honours consent for sensitive items', () => {
    expect(projectDoctorReport(report, 'upload', { consentToSensitive: true }).basics.userDataPath).toBeUndefined()
    expect(classes('upload', true)).toEqual(['public', 'consent_required'])
  })

  it.each(['copy', 'upload'] as const)('drops private result fields from the %s view', (view) => {
    expect(projectDoctorReport(report, view).results).toEqual([
      {
        id: 'storage-userdata-location',
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: 'fallback_to_default' },
        durationMs: 1,
        evidence: [{ key: 'errno', value: 'EACCES', dataClass: 'public' }]
      },
      { id: 'runtime-managed-tools', status: 'error', durationMs: 2 }
    ])
  })

  it('shows everything locally', () => {
    expect(classes('display')).toEqual(['public', 'local_only', 'consent_required'])
  })

  it.each(['display', 'export'] as const)('keeps developer text in the %s view', (view) => {
    const [warned, errored] = projectDoctorReport(report, view, { consentToSensitive: true }).results
    expect(warned).toMatchObject({ devMessage: 'developer trace at /Users/alice/private.log' })
    expect(errored).toMatchObject({ message: expect.stringContaining('private-runtime') })
  })
})

describe('doctorScopeKey', () => {
  // Main publishes under this key and the renderer subscribes to it; a drift between the two is a blank dialog.
  it('derives one key per subject and a fixed key for the global doctor', () => {
    expect(doctorScopeKey({ kind: 'global' })).toBe('global')
    expect(doctorScopeKey({ kind: 'chat', providerId: 'openai', modelId: 'gpt-4o' })).toBe('chat:openai/gpt-4o')
    expect(doctorScopeKey({ kind: 'agent', agentId: 'a1' })).toBe('agent:a1')
    expect(doctorScopeKey({ kind: 'agent', agentId: 'a1', providerId: 'deepseek', modelId: 'deepseek-v4-flash' })).toBe(
      'agent:a1:deepseek/deepseek-v4-flash'
    )
    expect(doctorScopeKey({ kind: 'operation', operationId: 'op-1' })).toBe('operation:op-1')
    expect(isDoctorScopeKey('operation:op-1')).toBe(true)
    expect(isDoctorScopeKey('chat:openai/gpt-4o')).toBe(true)
    expect(
      doctorAgentKey('operation:op-1', {
        kind: 'operation',
        context: {
          id: 'op-1',
          occurredAt: '2026-10-14T00:00:00.000Z',
          source: 'painting',
          operation: 'painting.generate',
          message: 'failed'
        }
      })
    ).toBe('operation:op-1#op-1')
    expect(doctorAgentKey('chat:openai/gpt-4o', { topicId: 'topic-1', messageId: 'message-1' })).toBe(
      'chat:openai/gpt-4o#message-1'
    )
  })

  it('gives each attempt of one message its own key and keeps a caller that omits errorId on the message id', () => {
    const scope = 'chat:openai/gpt-4o' as const
    const row = { topicId: 'topic-1', messageId: 'message-1' }
    expect(doctorAgentKey(scope, { ...row, errorId: 'err-1' })).toBe(`${scope}#err-1`)
    expect(doctorAgentKey(scope, { ...row, errorId: 'err-2' })).toBe(`${scope}#err-2`)
    expect(doctorAgentKey(scope, { ...row, errorId: 'err-2' })).not.toBe(
      doctorAgentKey(scope, { ...row, errorId: 'err-1' })
    )
    expect(doctorAgentKey(scope, row)).toBe(`${scope}#message-1`)
    expect(isOperationIncident(row)).toBe(false)
    expect(
      isOperationIncident({
        kind: 'operation',
        context: {
          id: 'op-1',
          occurredAt: '2026-10-14T00:00:00.000Z',
          source: 'painting',
          operation: 'painting.generate',
          message: 'failed'
        }
      })
    ).toBe(true)
  })

  it('encodes every scope as one legal collision-safe cache-template segment', () => {
    const keys = [
      doctorStateCacheKey('global'),
      doctorStateCacheKey('chat:openai/gpt-4o'),
      doctorStateCacheKey('agent:a1:deepseek/deepseek-v4-flash'),
      doctorStateCacheKey('chat:openai:gpt-4o')
    ]
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((key) => /^doctor\.state\.[\w-]+$/.test(key))).toBe(true)
  })

  it('accepts an operation subject and keeps the message incident shape', () => {
    expect(
      doctorRequestSchemas['diagnostics.doctor.run'].input.safeParse({
        tier: 'quick',
        subject: { kind: 'operation', operationId: 'op-1' }
      }).success
    ).toBe(true)
    expect(
      doctorRequestSchemas['diagnostics.doctor.run_contextual'].input.safeParse({
        subject: {
          kind: 'operation',
          operationId: 'paint-1',
          providerId: 'openai',
          modelId: 'gpt-image-1',
          imageOnly: true
        }
      }).success
    ).toBe(true)
    expect(
      doctorAgentRequestSchemas['diagnostics.doctor.agent.start'].input.safeParse({
        scope: 'operation:op-1',
        reportRunId: 'report-1',
        incident: { topicId: 'topic-1', messageId: 'message-1' }
      }).success
    ).toBe(true)
    expect(
      doctorAgentRequestSchemas['diagnostics.doctor.agent.start'].input.safeParse({
        scope: 'operation:op-1',
        reportRunId: 'report-1',
        incident: {
          kind: 'operation',
          context: {
            id: 'op-1',
            occurredAt: '2026-10-14T00:00:00.000Z',
            source: 'painting',
            operation: 'painting.generate',
            message: 'upstream failed'
          }
        }
      }).success
    ).toBe(true)
    expect(
      doctorAgentRequestSchemas['diagnostics.doctor.agent.start'].input.safeParse({
        scope: 'not-a-scope',
        reportRunId: 'report-1'
      }).success
    ).toBe(false)
    expect(
      doctorAgentRequestSchemas['diagnostics.doctor.agent.start'].input.safeParse({
        scope: 'operation:op-1',
        reportRunId: 'report-1',
        incident: { kind: 'operation', operationId: 'op-1', source: 'painting', operation: 'paint', message: 'failed' }
      }).success
    ).toBe(false)
  })
})

describe('doctor failure detail', () => {
  it('maps each service-owned run failure and leaves an external cause intact', () => {
    expect(
      doctorRunFailureDetail({
        error: 'not started: busy',
        errorSource: 'service',
        ownedFailure: { kind: 'not_started', reason: 'busy' }
      })
    ).toEqual({ source: 'service', failure: { kind: 'not_started', reason: 'busy' } })
    expect(
      doctorRunFailureDetail({
        error: 'not started: session-invalid',
        errorSource: 'service',
        ownedFailure: { kind: 'not_started', reason: 'session-invalid' }
      })
    ).toEqual({ source: 'service', failure: { kind: 'not_started', reason: 'session-invalid' } })
    expect(
      doctorRunFailureDetail({
        error: 'Execution failed',
        errorSource: 'service',
        ownedFailure: { kind: 'execution_failed' }
      })
    ).toEqual({ source: 'service', failure: { kind: 'execution_failed' } })
    expect(
      doctorRunFailureDetail({ error: 'unknown error', errorSource: 'service', ownedFailure: { kind: 'unknown' } })
    ).toEqual({ source: 'service', failure: { kind: 'unknown' } })
    expect(doctorRunFailureDetail({ error: 'database locked', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'database locked'
    })
    expect(doctorRunFailureDetail({ error: 'Execution failed', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'Execution failed'
    })
    expect(doctorRunFailureDetail({ error: 'not started: busy', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'not started: busy'
    })
    expect(doctorRunFailureDetail({ error: 'not started: something else' })).toEqual({
      source: 'external',
      text: 'not started: something else'
    })
  })

  it('still recognizes service sentences published before errorSource existed', () => {
    expect(doctorRunFailureDetail({ error: 'not started: busy' })).toEqual({
      source: 'service',
      failure: { kind: 'not_started', reason: 'busy' }
    })
    expect(doctorRunFailureDetail({ error: 'not started: session-invalid' })).toEqual({
      source: 'service',
      failure: { kind: 'not_started', reason: 'session-invalid' }
    })
    expect(doctorRunFailureDetail({ error: 'Execution failed' })).toEqual({
      source: 'service',
      failure: { kind: 'execution_failed' }
    })
    expect(doctorRunFailureDetail({ error: 'unknown error' })).toEqual({
      source: 'service',
      failure: { kind: 'unknown' }
    })
    expect(doctorRunFailureDetail({ error: 'disk full' })).toEqual({ source: 'external', text: 'disk full' })
  })

  it('keeps inherited property names as external evidence on unmarked legacy state', () => {
    for (const error of ['__proto__', 'constructor']) {
      expect(doctorRunFailureDetail({ error })).toEqual({ source: 'external', text: error })
      expect(doctorProposalFailureDetail({ error })).toEqual({ source: 'external', text: error })
    }
  })

  it('maps a superseded proposal and keeps an external proposal error', () => {
    expect(
      doctorProposalFailureDetail({
        error: 'report superseded',
        errorSource: 'service',
        ownedError: 'report_superseded'
      })
    ).toEqual({ source: 'service', failure: { kind: 'report_superseded' } })
    expect(doctorProposalFailureDetail({ error: 'report superseded' })).toEqual({
      source: 'service',
      failure: { kind: 'report_superseded' }
    })
    expect(doctorProposalFailureDetail({ error: 'unknown error' })).toEqual({
      source: 'service',
      failure: { kind: 'unknown' }
    })
    expect(doctorProposalFailureDetail({ error: 'unknown error', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'unknown error'
    })
    expect(doctorProposalFailureDetail({ error: 'disk full', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'disk full'
    })
    expect(doctorProposalFailureDetail({ error: 'report superseded', errorSource: 'external' })).toEqual({
      source: 'external',
      text: 'report superseded'
    })
    expect(doctorProposalFailureDetail({})).toBeUndefined()
  })
})
