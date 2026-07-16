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
          description: 'Search project documentation',
          name: 'search_docs',
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
    expect((response.tool as any).description).toBe('Search project documentation')
    expect((response.tool as any).serverId).toBe('docs-server')
    expect((response.tool as any).serverName).toBe('Docs')
    expect(response.response).toBe('ok')
  })

  it('keeps structured MCP arrays bare for dedicated tool renderers', () => {
    const results = [{ id: 1, title: 'Cherry Studio', url: 'https://example.com', content: 'result' }]
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'call-search',
      toolName: 'web_search',
      state: 'output-available',
      input: { query: 'Cherry Studio' },
      output: {
        content: results,
        metadata: { serverName: 'cherry-tools', serverId: 'cherry-tools', type: 'mcp' }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.response).toEqual(results)
  })

  it('preserves MCP content arrays as CallToolResult-shaped responses', () => {
    const content = [
      { type: 'text', text: 'QR code generated' },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
    ]
    const output = {
      content,
      metadata: { serverName: 'cherry-tools', serverId: 'cherry-tools', type: 'mcp' }
    }
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'call-image',
      toolName: 'config',
      state: 'output-available',
      input: {},
      output
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.response).toBe(output)
  })

  it('parses the cherry-tools wire name into server + tool (no metadata path)', () => {
    // Real production shape (from the agent_session_message table): a dynamic-tool part whose
    // toolName is the full `mcp__cherry-tools__web_search`, with NO output metadata. The single-
    // underscore wire name splits cleanly on the last `__` into server `cherry-tools` / tool
    // `web_search`.
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'call-cherry',
      toolName: 'mcp__cherry-tools__web_search',
      state: 'output-available',
      input: { query: 'latest news' },
      output: { content: '[]' }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response).toBeTruthy()
    if (!response) throw new Error('Expected tool response')
    expect(response.tool.type).toBe('mcp')
    expect(response.tool.name).toBe('web_search')
    expect((response.tool as any).serverId).toBe('cherry-tools')
  })

  it('keeps a successful tool_invoke as a meta (non-mcp) tool despite leaked inner result metadata', () => {
    // A completed tool_invoke carries the inner tool's result metadata (`type: 'mcp'`,
    // `serverName`). The outer meta-tool must NOT be reshaped into an MCP response.
    const part = {
      type: 'tool-tool_invoke',
      toolCallId: 'call-meta',
      state: 'output-available',
      input: { name: 'mcp__duckduckgo__search', params: { query: 'latest tech news' } },
      output: {
        content: 'ok',
        metadata: { serverName: 'duckduckgo', serverId: 'dd-server', type: 'mcp' }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response).toBeTruthy()
    if (!response) throw new Error('Expected tool response')
    expect(response.tool.type).not.toBe('mcp')
    expect(response.tool.name).toBe('tool_invoke')
    // Inner arguments stay intact for the meta renderer to unwrap.
    expect(response.arguments).toEqual({ name: 'mcp__duckduckgo__search', params: { query: 'latest tech news' } })
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

  it('maps tool-* streaming MCP part to invoking and displays the tool segment', () => {
    const part = {
      type: 'tool-mcp__assistant__read',
      toolCallId: 'call-3',
      state: 'input-available',
      input: { file_path: '/tmp/a.ts' }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('invoking')
    expect(response?.toolCallId).toBe('call-3')
    expect(response?.tool.name).toBe('read')
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

  it('resolves a real pi-agent tool part to a builtin tool via its cherry.tool metadata', () => {
    // Real pi shape (from piStreamAdapter's `toolProviderMetadata`): the transport tag plus a
    // `cherry.tool` descriptor of `{ type: 'builtin', name }`. The `cherry.tool.type` wins in
    // resolveToolType, so pi built-ins resolve to `builtin` — not `provider` — and keep their
    // lowercase name off the MCP path. chooseTool then routes them to the generic card.
    const part = {
      type: 'dynamic-tool',
      toolName: 'bash',
      toolCallId: 'pi-call-1',
      state: 'output-available',
      input: { command: 'ls' },
      output: 'ok',
      callProviderMetadata: {
        cherry: { transport: 'pi-agent', tool: { type: 'builtin', name: 'bash' } },
        pi: { toolName: 'bash' }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('done')
    expect(response?.tool.type).toBe('builtin')
    expect(response?.tool.name).toBe('bash')
  })

  it('routes a stamped ai-sdk-agent tool part to the generic provider card', () => {
    // Real ai-sdk shape (from streamAdapter's transport stamp on tool-input/output
    // chunks): a typed `tool-<name>` part whose cherry metadata carries only the
    // transport tag — no `cherry.tool` descriptor — so it resolves as `provider`
    // and renders on the generic agent tool card.
    const part = {
      type: 'tool-write',
      toolCallId: 'ai-sdk-call-1',
      state: 'output-available',
      input: { path: 'a.txt' },
      output: 'wrote',
      callProviderMetadata: {
        cherry: { transport: 'ai-sdk-agent' }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('done')
    expect(response?.tool.type).toBe('provider')
    expect(response?.tool.name).toBe('write')
  })

  it('renders a stamped ai-sdk-agent approval request as a pending provider card', () => {
    // Approval shape: the part reaches `approval-requested` via the SDK reducer;
    // the transport stamp arrived on the earlier tool-input chunks.
    const part = {
      type: 'tool-bash',
      toolCallId: 'ai-sdk-call-2',
      state: 'approval-requested',
      input: { command: 'pnpm build' },
      approval: { id: 'ai-sdk-approval-1' },
      callProviderMetadata: {
        cherry: { transport: 'ai-sdk-agent', toolName: 'bash' }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('pending')
    expect(response?.tool.type).toBe('provider')
    expect(response?.tool.name).toBe('bash')
  })

  it('keeps migrated agent dynamic-tool calls without metadata on the provider renderer path', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'WebSearch',
      toolCallId: 'legacy-call',
      state: 'output-available',
      input: { query: 'desktop clients' },
      output: 'ok'
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.status).toBe('done')
    expect(response?.tool.type).toBe('provider')
    expect(response?.tool.name).toBe('WebSearch')
  })

  it('parses Claude Code MCP tool ids as MCP tools without display metadata', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id',
      toolCallId: 'mcp-call',
      state: 'approval-requested',
      input: { libraryName: 'React' },
      approval: { id: 'approval-mcp' },
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: null
        }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response).toBeTruthy()
    if (!response) throw new Error('Expected tool response')
    expect(response.tool.type).toBe('mcp')
    expect(response.tool.name).toBe('resolve-library-id')
    expect((response.tool as any).serverId).toBe('8171b5f3-c666-4ead-b2ab-bb9ac244af57')
    expect((response.tool as any).serverName).toBe('8171b5f3-c666-4ead-b2ab-bb9ac244af57')
  })

  it('uses migrated cherry tool metadata from callProviderMetadata before name fallbacks', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'WebSearch',
      toolCallId: 'legacy-mcp-call',
      state: 'output-available',
      input: { query: 'desktop clients' },
      output: 'ok',
      callProviderMetadata: {
        cherry: {
          tool: {
            type: 'mcp',
            name: 'search_docs',
            description: 'Search desktop docs',
            serverId: 'search-server',
            serverName: 'Search'
          }
        }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response).toBeTruthy()
    if (!response) throw new Error('Expected tool response')
    expect(response.tool.type).toBe('mcp')
    expect(response.tool.name).toBe('search_docs')
    expect((response.tool as any).description).toBe('Search desktop docs')
    expect((response.tool as any).serverId).toBe('search-server')
    expect((response.tool as any).serverName).toBe('Search')
  })

  it('extracts parent tool id from Claude Code provider metadata', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'Read',
      toolCallId: 'child-call',
      state: 'output-available',
      input: { file_path: '/tmp/a.ts' },
      output: 'ok',
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: 'parent-call'
        }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.parentToolUseId).toBe('parent-call')
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
