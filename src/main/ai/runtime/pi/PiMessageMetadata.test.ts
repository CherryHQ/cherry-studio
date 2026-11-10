import { describe, expect, it } from 'vitest'

import { webSearchOutputSchema } from '@shared/ai/builtinTools'
import { PI_TOOL_CALL_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import type { CherryUIMessage } from '@shared/data/types/message'

import { PI_TRANSPORT, PiMessageMetadata } from './PiMessageMetadata'

function output(toolName: string, value: unknown, input: unknown = {}) {
  const message: CherryUIMessage = {
    id: 'native',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Before', state: 'done' },
      {
        type: 'dynamic-tool',
        toolName,
        toolCallId: 'native-call',
        state: 'output-available',
        input,
        output: value,
        preliminary: true
      },
      { type: 'text', text: 'After', state: 'done' }
    ]
  }
  const decorated = new PiMessageMetadata().decorate(message)
  expect(decorated.parts[0]).toEqual(message.parts[0])
  expect(decorated.parts[2]).toEqual(message.parts[2])
  const part = decorated.parts[1]
  if (part.type !== 'dynamic-tool' || part.state !== 'output-available') throw new Error('Missing tool output')
  expect(part.toolCallId).toBe('native-call')
  expect(part.preliminary).toBe(true)
  return part
}

describe('Pi message display metadata', () => {
  it('decorates MCP identity without replacing its native identity or progress state', () => {
    expect(output('mcp__exa__search', { content: [{ type: 'text', text: 'results' }] })).toMatchObject({
      output: 'results',
      providerExecuted: true,
      callProviderMetadata: {
        cherry: { transport: PI_TRANSPORT, tool: { type: 'mcp', name: 'search', serverName: 'exa' } }
      }
    })
  })

  it('preserves code-mode results, artifact inputs and rich automation content', () => {
    const details = { result: { total: 1 }, logs: ['searched'] }
    expect(output('tool_exec', { content: [{ type: 'text', text: '{"total":1}' }], details }).output).toEqual(details)
    const input = { artifacts: [{ path: 'dist/report.md', description: 'Final report' }], summary: 'Created report' }
    expect(output('mcp__cherry-tools__report_artifacts', 'Recorded 1 artifact(s).', input).input).toEqual(input)
    const mcp = {
      content: [
        { type: 'text', text: '649' },
        { type: 'text', text: 'REPL_CONTEXT {}', annotations: { audience: ['assistant'] } }
      ],
      structuredContent: { replContext: { cell: 'c1' } }
    }
    expect(
      output('mcp__automation__js', {
        content: [{ type: 'text', text: '649\nREPL_CONTEXT {}' }],
        structuredContent: mcp
      }).output
    ).toEqual(mcp)
  })

  it('keeps search results readable by the citation resolver and retains non-text content', () => {
    const results = [{ id: '19ff9dcd-1', title: 'First', url: 'https://a.com', content: 'x' }]
    const search = output(PI_TOOL_CALL_TOOL_NAME, {
      content: [{ type: 'text', text: JSON.stringify(results) }],
      details: null
    }).output
    expect(search).toEqual(results)
    expect(webSearchOutputSchema.safeParse(search).success).toBe(true)
    expect(output(PI_TOOL_CALL_TOOL_NAME, { content: [{ type: 'text', text: 'plain results' }] }).output).toBe(
      'plain results'
    )
    const rich = [
      { type: 'text', text: 'shot' },
      { type: 'image', data: 'aGk=', mimeType: 'image/png' }
    ]
    expect(output(PI_TOOL_CALL_TOOL_NAME, { content: rich }).output).toEqual(rich)
  })

  it('retains tool failures and the native error payload', () => {
    const message: CherryUIMessage = {
      id: 'native',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'error',
          toolName: 'edit',
          input: {},
          state: 'output-error',
          errorText: 'boom',
          resultProviderMetadata: { pi: { result: { details: 'failure context' } } }
        }
      ]
    }
    expect(new PiMessageMetadata().decorate(message).parts[0]).toMatchObject({
      state: 'output-error',
      errorText: 'boom',
      resultProviderMetadata: { pi: { result: { details: 'failure context' } } },
      callProviderMetadata: { cherry: { transport: PI_TRANSPORT } }
    })
  })
})
