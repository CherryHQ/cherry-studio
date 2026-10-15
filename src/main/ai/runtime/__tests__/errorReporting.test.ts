import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { describe, expect, it } from 'vitest'

import { logAiFailure } from '@main/ai/errorReporting'
import { serializeError } from '@main/ai/utils/serializeError'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { shouldReportFailure } from '@shared/utils/errorReporting'
import { getSentryLogContext } from '@shared/utils/sentry'

import { classifyClaudeFailure } from '../claudeCode/failureFacts'
import { ClaudeCodeResultError } from '../claudeCode/streamAdapter'
import { classifyPiFailure } from '../pi/failureFacts'

describe('runtime reporting decisions', () => {
  it.each(['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'] as const)(
    'keeps Claude %s in diagnostics, regardless of the wrapper exitCode',
    (subtype) => {
      const failure = classifyClaudeFailure(new ClaudeCodeResultError('Limit reached', subtype, []))
      expect(shouldReportFailure(failure)).toBe(false)
      expect(failure.reason).toBe(subtype)
    }
  )

  it('uses the API status even when Claude returns subtype success', () => {
    const failure = classifyClaudeFailure(new ClaudeCodeResultError('Unauthorized', 'success', [], 'api_error', 401))
    expect(failure.source).toBe('provider')
    expect(shouldReportFailure(failure)).toBe(false)
  })

  it('retains unknown Claude execution errors and actual process crashes', () => {
    const failure = classifyClaudeFailure(
      new ClaudeCodeResultError('Unexpected SDK state', 'error_during_execution', [])
    )
    expect(shouldReportFailure(failure)).toBe(true)
    expect(failure.kind).toBe('unknown')
    const crash = new Error('Claude Code process terminated by signal SIGSEGV')
    expect(classifyClaudeFailure(crash).kind).toBe('reliability')
    expect(shouldReportFailure(classifyClaudeFailure(crash, { cancelled: true }))).toBe(false)
  })

  it('does not confuse Pi output limits, provider failures and program defects', () => {
    expect(shouldReportFailure(classifyPiFailure(new Error('Truncated'), { stopReason: 'length' }))).toBe(false)
    expect(shouldReportFailure(classifyPiFailure(new Error('insufficient balance'), { returnedFailure: true }))).toBe(
      false
    )
    expect(classifyPiFailure(new TypeError('Cannot read network state')).kind).toBe('defect')
    expect(classifyPiFailure(new TypeError('Bad stream'), { stopReason: 'length' }).kind).toBe('defect')
    expect(shouldReportFailure(classifyPiFailure(new Error('Cannot read network state')))).toBe(true)
  })

  it('retains a recovered SDK fault but excludes expected compaction cancellation', () => {
    expect(shouldReportFailure(classifyPiFailure(new TypeError('Bad history'), { recovered: true }))).toBe(true)
    expect(shouldReportFailure(classifyPiFailure({ message: 'Compaction aborted' }, { cancelled: true }))).toBe(false)
  })

  it('preserves ownership across repeated logging and IPC without exposing provider payloads', () => {
    mockMainLoggerService.error.mockClear()
    const error = Object.assign(new Error('private conversation content'), {
      responseBody: 'private conversation content'
    })
    const facts = classifyPiFailure(error)
    logAiFailure(mockMainLoggerService, 'Pi failed', error, 'agent.pi.prompt', facts)
    const first = mockMainLoggerService.error.mock.calls[0][1]
    expect(getSentryLogContext({ ...first, level: 'error' })).toBeDefined()
    expect(JSON.stringify(first)).not.toContain('private conversation content')
    logAiFailure(mockMainLoggerService, 'Pi failed again', error, 'agent.pi.prompt', facts)
    expect(getSentryLogContext({ ...mockMainLoggerService.error.mock.calls[1][1], level: 'error' })).toBeUndefined()
    expect(serializeError(error).reportingHandled).toBe(true)
    const received = IpcError.fromJSON({ code: 'INTERNAL', message: 'Failure', reportingHandled: true })
    expect(
      getSentryLogContext({ level: 'error', stack: received.stack, reportingHandled: received.reportingHandled })
    ).toBeUndefined()
  })
})
