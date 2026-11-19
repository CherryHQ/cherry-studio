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

  it('preserves own reserved keys and JSON numeric results in MCP text', () => {
    const text = '{"__proto__":{"label":"retained"},"constructor":"own constructor","value":1e400}'
    const projected = output(PI_TOOL_CALL_TOOL_NAME, { content: [{ type: 'text', text }] }).output

    expect(Object.getOwnPropertyDescriptor(projected, '__proto__')).toMatchObject({ value: { label: 'retained' } })
    expect(Object.getOwnPropertyDescriptor(projected, 'constructor')).toMatchObject({ value: 'own constructor' })
    expect(projected).toHaveProperty('value', Infinity)
  })

  it.each([
    { label: 'null block', content: [null] },
    { label: 'non-string text', content: [{ type: 'text', text: 42 }] },
    { label: 'missing text', content: [{ type: 'text' }] },
    { label: 'future block', content: [{ type: 'audio', data: 'aGk=' }] }
  ])('preserves $label without treating it as text', ({ content }) => {
    expect(output(PI_TOOL_CALL_TOOL_NAME, { content }).output).toBe(content)
  })

  it('keeps native result metadata and identity when content requires no unwrapping', () => {
    const result = { content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }], details: { native: true } }
    expect(output('native_tool', result).output).toBe(result)
  })

  it('keeps valid deeply nested JSON decoded', () => {
    const depth = 4000
    const text = `${'['.repeat(depth)}0${']'.repeat(depth)}`
    let value = output(PI_TOOL_CALL_TOOL_NAME, { content: [{ type: 'text', text }] }).output
    let levels = 0
    while (Array.isArray(value)) {
      levels += 1
      value = value[0]
    }

    expect(levels).toBe(depth)
    expect(value).toBe(0)
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

it.each([false, true])('recovers successful nested declarations even if the outer script failed (%s)', (failed) => {
  const input = { artifacts: [{ path: '/workspace/report.html', description: 'Report' }] }
  const result = {
    content: [{ type: 'text', text: 'Script output' }],
    nestedCalls: {
      complete: false,
      calls: [
        { id: 'script/1', name: 'mcp__cherry_tools__report_artifacts', status: 'ok', arguments: input },
        { id: 'script/2', name: 'mcp__cherry_tools__report_artifacts', status: 'error', arguments: input },
        { id: 'script/3', name: 'mcp__cherry_tools__report_artifacts', status: 'unfinished', arguments: input },
        { id: 'script/4', name: 'mcp__cherry_tools__report_artifacts', status: 'ok', argumentsBytes: 90000 },
        { id: 'script/5', name: 'mcp__other__report_artifacts', status: 'ok', arguments: input },
        { id: 'script/6', name: 'mcp__cherry_tools__report_artifacts', status: 'ok', arguments: { artifacts: [] } }
      ]
    }
  }
  const message: CherryUIMessage = {
    id: 'reply',
    role: 'assistant',
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'codemode',
        toolCallId: 'script',
        input: { code: 'fixture' },
        ...(failed
          ? { state: 'output-error', errorText: 'Later script failure', resultProviderMetadata: { pi: { result } } }
          : { state: 'output-available', output: result })
      }
    ]
  }
  const metadata = new PiMessageMetadata()
  const decorated = metadata.decorate(message)
  expect(decorated.parts).toHaveLength(2)
  expect(decorated.parts[1]).toMatchObject({
    type: 'dynamic-tool',
    toolName: 'mcp__cherry_tools__report_artifacts',
    toolCallId: 'script/1',
    state: 'output-available',
    input,
    callProviderMetadata: { cherry: { tool: { type: 'mcp', name: 'report_artifacts', serverName: 'cherry-tools' } } }
  })
  expect(metadata.decorate(decorated).parts).toHaveLength(2)
})

it('preserves native nested metadata without duplicating an already projected artifact', () => {
  const input = { artifacts: [{ path: '/workspace/report.html' }] }
  const message: CherryUIMessage = {
    id: 'nested-reply',
    role: 'assistant',
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'codemode',
        toolCallId: 'script',
        state: 'output-available',
        input: {},
        output: {
          content: [],
          nestedCalls: {
            calls: [{ id: 'script/1', name: 'mcp__cherry_tools__report_artifacts', status: 'ok', arguments: input }]
          }
        }
      },
      {
        type: 'dynamic-tool',
        toolName: 'mcp__cherry_tools__report_artifacts',
        toolCallId: 'script/1',
        state: 'output-available',
        input,
        output: { content: [{ type: 'text', text: 'Recorded' }] },
        callProviderMetadata: { pi: { parentToolCallId: 'script', nested: true, resultOmitted: false } }
      }
    ]
  }
  const decorated = new PiMessageMetadata().decorate(message)
  expect(decorated.parts).toHaveLength(2)
  expect(decorated.parts[1]).toMatchObject({
    toolCallId: 'script/1',
    input,
    callProviderMetadata: {
      pi: { parentToolCallId: 'script', nested: true, resultOmitted: false },
      cherry: { tool: { type: 'mcp', serverName: 'cherry-tools', name: 'report_artifacts' } }
    }
  })
})
