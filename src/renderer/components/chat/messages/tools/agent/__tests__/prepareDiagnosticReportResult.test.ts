import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import {
  findLatestPrepareDiagnosticReportResult,
  getPrepareDiagnosticReportResult,
  parsePrepareDiagnosticReportResult
} from '../prepareDiagnosticReportResult'

const result = (description: string) => ({ ok: true as const, description })

function reportPart(
  toolCallId: string,
  output: unknown,
  state: 'input-available' | 'input-streaming' | 'output-available' | 'output-error' = 'output-available',
  toolName = 'mcp__assistant__prepare_diagnostic_report'
): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input: { description: 'input draft' },
    ...(state === 'output-error' ? { errorText: 'failed' } : { output })
  } as CherryMessagePart
}

function message(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: 'assistant', parts } as CherryUIMessage
}

describe('prepareDiagnosticReportResult', () => {
  it.each([
    ['direct result', result('Direct draft'), 'Direct draft'],
    [
      'structured MCP result',
      { content: [{ type: 'text', text: 'prepared' }], structuredContent: result('Structured draft') },
      'Structured draft'
    ],
    ['JSON text MCP result', { content: [{ type: 'text', text: JSON.stringify(result('JSON draft')) }] }, 'JSON draft']
  ])('parses a complete %s', (_label, value, description) => {
    expect(parsePrepareDiagnosticReportResult(value)).toEqual(result(description))
  })

  it('rejects blank, partial, and unsuccessful payloads', () => {
    expect(parsePrepareDiagnosticReportResult({ ok: true, description: '   ' })).toBeUndefined()
    expect(parsePrepareDiagnosticReportResult({ ok: false, description: 'Failed draft' })).toBeUndefined()
    expect(parsePrepareDiagnosticReportResult({ structuredContent: { ok: true } })).toBeUndefined()
    expect(
      parsePrepareDiagnosticReportResult({ isError: true, structuredContent: result('Misleading draft') })
    ).toBeUndefined()
  })

  it('accepts only a completed assistant prepare_diagnostic_report tool', () => {
    expect(getPrepareDiagnosticReportResult(reportPart('complete', result('Complete draft')))).toEqual(
      result('Complete draft')
    )
    expect(
      getPrepareDiagnosticReportResult(
        reportPart('wrong-server', result('Wrong server'), 'output-available', 'mcp__other__prepare_diagnostic_report')
      )
    ).toBeUndefined()
    expect(getPrepareDiagnosticReportResult(reportPart('partial', undefined, 'input-streaming'))).toBeUndefined()
    expect(getPrepareDiagnosticReportResult(reportPart('invoking', undefined, 'input-available'))).toBeUndefined()
    expect(
      getPrepareDiagnosticReportResult(reportPart('failed', result('Failed draft'), 'output-error'))
    ).toBeUndefined()
  })

  it('selects the last complete success by message and part order without letting later failures replace it', () => {
    const first = reportPart('first', {
      content: [{ type: 'text', text: 'Diagnostic report draft prepared.' }],
      metadata: { type: 'mcp', serverId: 'assistant', serverName: 'assistant' },
      structuredContent: result('First draft')
    })
    const second = reportPart('second', { content: [{ type: 'text', text: JSON.stringify(result('Second draft')) }] })
    const partial = reportPart('partial', undefined, 'input-streaming')
    const failed = reportPart('failed', result('Failed draft'), 'output-error')

    expect(
      findLatestPrepareDiagnosticReportResult(
        [message('message-1', [first, second]), message('message-2', [partial, failed])],
        {
          'message-1': [first, second],
          'message-2': [partial, failed]
        }
      )
    ).toEqual(result('Second draft'))
  })
})
