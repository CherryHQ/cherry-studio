import { buildToolResponseFromPart } from '@renderer/components/chat/messages/tools/toolResponse'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { getPrepareDiagnosticReportResult, parsePrepareDiagnosticReportResult } from '../prepareDiagnosticReportResult'

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

function reportResponse(
  toolCallId: string,
  output: unknown,
  state: 'input-available' | 'input-streaming' | 'output-available' | 'output-error' = 'output-available',
  toolName = 'mcp__assistant__prepare_diagnostic_report'
) {
  const toolResponse = buildToolResponseFromPart(reportPart(toolCallId, output, state, toolName))
  if (!toolResponse) throw new Error('Expected a tool response')
  return toolResponse
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

  it('normalizes a safe renderer draft and rejects descriptions beyond the IPC limit', () => {
    expect(parsePrepareDiagnosticReportResult(result('  First line\r\nSecond line  '))).toEqual(
      result('First line\r\nSecond line')
    )
    expect(parsePrepareDiagnosticReportResult(result('a'.repeat(4_097)))).toBeUndefined()
  })

  it('accepts only a completed assistant prepare_diagnostic_report tool', () => {
    expect(getPrepareDiagnosticReportResult(reportResponse('complete', result('Complete draft')))).toEqual(
      result('Complete draft')
    )
    expect(
      getPrepareDiagnosticReportResult(
        reportResponse(
          'wrong-server',
          result('Wrong server'),
          'output-available',
          'mcp__other__prepare_diagnostic_report'
        )
      )
    ).toBeUndefined()
    expect(getPrepareDiagnosticReportResult(reportResponse('partial', undefined, 'input-streaming'))).toBeUndefined()
    expect(getPrepareDiagnosticReportResult(reportResponse('invoking', undefined, 'input-available'))).toBeUndefined()
    expect(
      getPrepareDiagnosticReportResult(reportResponse('failed', result('Failed draft'), 'output-error'))
    ).toBeUndefined()
  })
})
