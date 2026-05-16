import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildToolResponseFromPart } from '../toolResponse'

describe('toolResponse adapter', () => {
  it('maps structured dynamic-tool output metadata to MCP tool fields', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'call-1',
      toolName: 'search_docs',
      state: 'output-available',
      input: { q: 'hello' },
      output: {
        content: 'ok',
        metadata: {
          serverName: 'Docs',
          serverId: 'docs-server',
          type: 'mcp'
        }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response).toBeTruthy()
    if (!response) throw new Error('Expected tool response')
    expect(response.status).toBe('done')
    expect(response.tool.type).toBe('mcp')
    expect(response.tool.name).toBe('search_docs')
    expect((response.tool as any).serverId).toBe('docs-server')
    expect((response.tool as any).serverName).toBe('Docs')
    expect(response.response).toBe('ok')
  })

  it('maps output-error to error status and error-shaped response', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'call-2',
      toolName: 'search_docs',
      state: 'output-error',
      errorText: 'failed'
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('error')
    expect(response?.response).toMatchObject({
      isError: true
    })
  })

  it('maps tool-* streaming part to invoking and keeps toolCallId', () => {
    const part = {
      type: 'tool-mcp__assistant__read',
      toolCallId: 'call-3',
      state: 'input-available',
      input: { file_path: '/tmp/a.ts' }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('invoking')
    expect(response?.toolCallId).toBe('call-3')
    expect(response?.tool.name).toBe('mcp__assistant__read')
  })

  it('keeps real Claude Code dynamic tool calls on the provider renderer path', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'CustomTool',
      toolCallId: 'call-4',
      state: 'approval-requested',
      input: { command: 'pnpm test' },
      approval: { id: 'approval-4' },
      callProviderMetadata: {
        'claude-code': {
          rawInput: { command: 'pnpm test' },
          parentToolCallId: null
        }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('pending')
    expect(response?.tool.type).toBe('provider')
    expect(response?.tool.name).toBe('CustomTool')
  })

  it('does not synthesize a tool response without an AI SDK toolCallId', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'CustomTool',
      state: 'approval-requested',
      input: { command: 'pnpm test' },
      approval: { id: 'approval-missing-call' }
    } as unknown as CherryMessagePart

    expect(buildToolResponseFromPart(part)).toBeNull()
  })
})
