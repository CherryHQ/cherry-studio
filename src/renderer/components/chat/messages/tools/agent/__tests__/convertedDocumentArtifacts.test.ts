import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../../toolResponse'
import { getReportArtifactsViewModel, isReportArtifactsToolResponse } from '../ReportArtifacts'

function conversionPart(state: string, output?: unknown): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'convert-1',
    toolName: 'mcp__cherry-tools__convert_to_document',
    state,
    input: { markdown: '# Report', format: 'pdf', output_path: 'requested.pdf' },
    output
  } as CherryMessagePart
}

const output = {
  content: [{ type: 'text', text: JSON.stringify({ path: 'report.pdf', format: 'pdf', mime: 'application/pdf' }) }]
}

describe('converted document artifact cards', () => {
  it.each(['tool_call', 'mcp__cherry-tools__convert_to_document'])(
    'shows successful Pi %s conversions without a second tool call',
    (toolName) => {
      const receipt = JSON.parse(output.content[0].text)
      const responseOutput = receipt
      const part = {
        ...conversionPart('output-available'),
        toolName,
        input:
          toolName === 'tool_call'
            ? { name: 'mcp__cherry-tools__convert_to_document', params: {} }
            : { markdown: '# Report', format: 'pdf' },
        callProviderMetadata: { cherry: { parentToolCallId: 'exec-1' } },
        output: responseOutput
      } as CherryMessagePart
      const response = buildToolResponseFromPart(part)!
      expect(isReportArtifactsToolResponse(response)).toBe(true)
      expect(getReportArtifactsViewModel([response])?.artifacts).toEqual([{ path: 'report.pdf' }])

      for (const state of ['approval-requested', 'input-available', 'output-error']) {
        const unfinished = buildToolResponseFromPart({ ...part, state } as CherryMessagePart)!
        expect(getReportArtifactsViewModel([unfinished])).toBeNull()
      }
      const failed = buildToolResponseFromPart({
        ...part,
        output: { ...responseOutput, isError: true }
      } as CherryMessagePart)!
      expect(getReportArtifactsViewModel([failed])).toBeNull()
    }
  )

  it.each([
    output,
    { content: output, metadata: { type: 'mcp', serverName: 'cherry-tools' } },
    output.content,
    output.content[0].text,
    JSON.parse(output.content[0].text)
  ])('uses the runtime receipt as the deliverable, with no report_artifacts call', (receipt) => {
    const response = buildToolResponseFromPart(conversionPart('output-available', receipt), 'convert-1')!
    expect(isReportArtifactsToolResponse(response)).toBe(true)
    expect(getReportArtifactsViewModel([response])?.artifacts).toEqual([{ path: 'report.pdf' }])
  })

  it('keeps approvals, in-flight conversions, and failures in the tool UI without claiming a file exists', () => {
    for (const part of [
      conversionPart('approval-requested'),
      conversionPart('input-available'),
      conversionPart('output-denied'),
      conversionPart('output-error'),
      conversionPart('output-available', { ...output, isError: true }),
      conversionPart('output-available', { content: [{ type: 'text', text: 'invalid receipt' }] })
    ]) {
      const response = buildToolResponseFromPart(part, 'convert-1')!
      expect(isReportArtifactsToolResponse(response)).toBe(false)
      expect(getReportArtifactsViewModel([response])).toBeNull()
    }
  })
})
