import { describe, expect, it } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../../toolResponse'
import { getAgentNavigateResult, isAgentNavigateResultPart } from '../navigateResult'

const input = { path: '/settings/provider', query: { id: 'provider-1' } }
const output = 'Navigate link created: /settings/provider?id=provider-1'
const tool = {
  id: 'assistant__navigate',
  type: 'mcp' as const,
  serverId: 'assistant',
  serverName: 'assistant',
  name: 'navigate'
}
function response(overrides: Partial<NormalToolResponse> = {}): NormalToolResponse {
  return {
    id: 'navigate-1',
    toolCallId: 'navigate-1',
    tool,
    status: 'done',
    arguments: input,
    response: output,
    ...overrides
  }
}
function part(overrides: Record<string, unknown> = {}): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'navigate-1',
    toolName: 'mcp__assistant__navigate',
    providerExecuted: true,
    state: 'output-available',
    input,
    callProviderMetadata: { cherry: { transport: 'claude-agent', tool } },
    output: { content: output, metadata: tool },
    ...overrides
  }
}
function expectRejected(value: CherryMessagePart) {
  expect(isAgentNavigateResultPart(value)).toBe(false)
  const built = buildToolResponseFromPart(value)
  if (built) expect(getAgentNavigateResult(built)).toBeUndefined()
}

describe('Agent navigate success contract', () => {
  it.each([
    tool,
    { ...tool, name: 'mcp__assistant__navigate' },
    { ...tool, name: 'alias', id: 'mcp__assistant__navigate' }
  ])('accepts assistant MCP identity $name / $id', (identity) => {
    expect(getAgentNavigateResult(response({ tool: identity }))).toEqual({ input, output })
  })

  it.each(['mcp__assistant__navigate', 'navigate'])('classifies the adapter part with wire name %s', (toolName) => {
    expect(isAgentNavigateResultPart(part({ toolName }))).toBe(true)
  })

  it('accepts prefix fallback without metadata and preserves the argument target', () => {
    expect(isAgentNavigateResultPart(part({ callProviderMetadata: undefined, output }))).toBe(true)
    const target = { path: '/app/agents' }
    expect(getAgentNavigateResult(response({ arguments: target }))).toEqual({ input: target, output })
    expect(getAgentNavigateResult(response({ arguments: { path: '/app/agents', query: {} } }))).toEqual({
      input: { path: '/app/agents', query: {} },
      output
    })
  })

  it.each([
    { ...tool, name: 'nav' },
    { ...tool, name: 'Navigate' },
    { ...tool, name: 'navigate_extra' },
    { ...tool, name: 'assistant__navigate' },
    { ...tool, name: 'navigate', serverId: 'other' },
    { ...tool, name: 'mcp__assistant__navigate', serverId: 'other' },
    { ...tool, id: 'mcp__assistant__navigate', serverId: 'other' },
    { ...tool, type: 'provider' as const, name: 'mcp__assistant__navigate' }
  ])('rejects non-assistant MCP identity $type / $serverId / $name / $id', (identity) => {
    const value = response({ tool: identity })
    expect(getAgentNavigateResult(value)).toBeUndefined()
    expectRejected(
      part({ output: { content: output, metadata: identity }, callProviderMetadata: { cherry: { tool: identity } } })
    )
  })

  it.each(['pending', 'streaming', 'invoking', 'error', 'cancelled'] as const)('rejects status %s', (status) => {
    expect(getAgentNavigateResult(response({ status }))).toBeUndefined()
  })

  it.each([
    'input-streaming',
    'input-available',
    'approval-requested',
    'approval-responded',
    'output-error',
    'output-denied',
    'cancelled'
  ])('does not classify state %s', (state) => {
    expectRejected(part({ state, approval: { id: 'approval-1', approved: false }, errorText: 'Failed' }))
  })

  it('rejects explicit denial even when output is available', () => {
    expect(getAgentNavigateResult(response({ approval: { approved: false } }))).toBeUndefined()
    expectRejected(part({ approval: { id: 'approval-1', approved: false } }))
  })

  it.each([
    undefined,
    null,
    [],
    'partial',
    {},
    { path: '' },
    { path: 1 },
    { path: '/settings/provider', query: { id: 1 } },
    { path: '/settings/provider', query: { id: 'provider-1', invalid: false } },
    { path: '/settings/provider', query: null },
    { path: '/settings/provider', query: [] },
    { path: '/settings/provider', query: 'id=provider-1' },
    { path: '/settings/provider', query: undefined }
  ])('rejects incomplete or lossy arguments %j', (argumentsValue) => {
    expect(
      getAgentNavigateResult(response({ arguments: argumentsValue as NormalToolResponse['arguments'] }))
    ).toBeUndefined()
    expectRejected(part({ input: argumentsValue }))
  })

  it.each([
    undefined,
    '',
    'Navigation failed',
    'Navigate link created: ',
    'prefix Navigate link created: /app/agents',
    { isError: true, content: 'Failed' },
    { $deferredToolResult: { topicId: 'session-1', messageId: 'message-1', toolCallId: 'navigate-1' } }
  ])('rejects unsuccessful or unresolved output %j', (value) => {
    expect(getAgentNavigateResult(response({ response: value }))).toBeUndefined()
    expectRejected(part({ output: value }))
  })

  it('rejects non-tool parts', () => {
    expect(isAgentNavigateResultPart({ type: 'text', text: output })).toBe(false)
  })
})
