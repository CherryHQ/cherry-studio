import { describe, expect, it } from 'vitest'

import { buildToolResponseFromPart, normalizeToolErrorResponse } from '../../toolResponse'
import { getAutomationCell, parseAutomationReplOutput } from '../automationRepl'

const failedCell = {
  isError: true,
  content: [
    { type: 'text', text: 'LISTED \nTypeError: cannot read property id of undefined' },
    { type: 'text', text: 'REPL_CONTEXT {}', annotations: { audience: ['assistant'] } }
  ]
}

describe('parseAutomationReplOutput', () => {
  it('shows the script error, not the serialized result, when a cell fails', () => {
    const result = parseAutomationReplOutput(normalizeToolErrorResponse(JSON.stringify(failedCell)))
    expect(result).toEqual({ text: 'LISTED \nTypeError: cannot read property id of undefined', isError: true })
  })

  it('unwraps a serialized content array from runtimes that forward only blocks', () => {
    const result = parseAutomationReplOutput(normalizeToolErrorResponse(JSON.stringify(failedCell.content)))
    expect(result.text).toBe('LISTED \nTypeError: cannot read property id of undefined')
  })

  it('keeps a plain error message as is', () => {
    expect(parseAutomationReplOutput(normalizeToolErrorResponse('Automation run is no longer active'))).toEqual({
      text: 'Automation run is no longer active',
      isError: true
    })
  })
})

it('correlates only validated cell IDs without reading target apps from tool output', () => {
  const cell = '12345678-1234-4234-8234-123456789abc'
  expect(getAutomationCell({ content: [], structuredContent: { replContext: { cell } } })).toBe(cell)
  expect(
    getAutomationCell({
      isError: true,
      content: [{ type: 'text', text: 'Failed' }],
      structuredContent: { replContext: { cell } }
    })
  ).toBe(cell)
  expect(
    getAutomationCell([
      { type: 'text', text: `REPL_CONTEXT ${JSON.stringify({ cell })}`, annotations: { audience: ['assistant'] } }
    ])
  ).toBe(cell)
  expect(getAutomationCell([{ type: 'text', text: `REPL_CONTEXT ${JSON.stringify({ cell })}` }])).toBe(cell)
  expect(getAutomationCell({ content: [], structuredContent: { replContext: { cell: 'invalid' } } })).toBeUndefined()
})

it('recovers the cell from Claude and Pi Durable text-only results without matching observation text', () => {
  const cell = '12345678-1234-4234-8234-123456789abc'
  const output = `OBSERVATION Finder\nREPL_CONTEXT ${JSON.stringify({ cell })}`
  expect(getAutomationCell(output)).toBe(cell)
  expect(getAutomationCell({ content: [{ type: 'text', text: output }], isError: false })).toBe(cell)
  expect(getAutomationCell(normalizeToolErrorResponse(output))).toBe(cell)
  expect(getAutomationCell(`${output}\n`)).toBe(cell)
  expect(getAutomationCell(`${output}\nMore observed text`)).toBeUndefined()
  expect(getAutomationCell('REPL_CONTEXT {"cell":"invalid"}')).toBeUndefined()
  const part = {
    type: 'dynamic-tool' as const,
    toolName: 'mcp__automation__js',
    toolCallId: 'claude-call',
    input: {},
    state: 'output-available' as const,
    output: { content: output, metadata: { type: 'mcp', name: 'js', serverId: 'automation' } }
  }
  expect(getAutomationCell(buildToolResponseFromPart(part)?.response)).toBe(cell)
})
