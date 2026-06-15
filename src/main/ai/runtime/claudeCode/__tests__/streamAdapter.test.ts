import type { CherryUIMessageChunk } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => loggerMocks)
  }
}))

const { ClaudeCodeStreamAdapter } = await import('../streamAdapter')

beforeEach(() => {
  vi.clearAllMocks()
})

function createAdapter(overrides: Partial<ConstructorParameters<typeof ClaudeCodeStreamAdapter>[0]> = {}) {
  const parts: CherryUIMessageChunk[] = []
  const sessionIds: string[] = []
  const adapter = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    streamOptions: { prompt: [] } as any,
    sink: { enqueue: (part) => parts.push(part) },
    onSessionId: (sessionId) => sessionIds.push(sessionId),
    ...overrides
  })
  return { adapter, parts, sessionIds }
}

function streamEvent(event: Record<string, unknown>) {
  return {
    type: 'stream_event',
    event,
    session_id: 'sdk-1',
    uuid: crypto.randomUUID()
  } as any
}

function usage() {
  return {
    input_tokens: 3,
    output_tokens: 5,
    cache_creation_input_tokens: 7,
    cache_read_input_tokens: 11
  }
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 123,
    duration_api_ms: 100,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage: usage(),
    modelUsage: {},
    permission_denials: [],
    uuid: crypto.randomUUID(),
    session_id: 'sdk-result',
    ...overrides
  } as any
}

describe('ClaudeCodeStreamAdapter', () => {
  it('maps system init to response metadata and captures session id', () => {
    const { adapter, parts, sessionIds } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sdk-init',
      uuid: crypto.randomUUID(),
      mcp_servers: [],
      model: 'claude-sonnet',
      tools: [],
      cwd: '/tmp',
      claude_code_version: '1.0.0',
      apiKeySource: 'none',
      permissionMode: 'default',
      slash_commands: [],
      output_style: 'default',
      skills: [],
      plugins: []
    } as any)

    expect(sessionIds).toEqual(['sdk-init'])
    expect(parts).toEqual([
      expect.objectContaining({
        type: 'message-metadata',
        messageMetadata: { modelId: 'sonnet' }
      })
    ])
  })

  it('handles compact_boundary system messages without dropping them silently or emitting chunks', () => {
    const { adapter, parts } = createAdapter()

    const result = adapter.handleMessage({
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'sdk-compact',
      uuid: crypto.randomUUID(),
      compact_metadata: { trigger: 'auto', pre_tokens: 50_000, post_tokens: 12_000 }
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([])
  })

  it('acknowledges status control system messages without emitting chunks or unhandled debug logs', () => {
    const { adapter, parts } = createAdapter()

    const result = adapter.handleMessage({
      type: 'system',
      subtype: 'status',
      session_id: 'sdk-control',
      uuid: crypto.randomUUID(),
      status: 'requesting'
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([])
    expect(loggerMocks.debug).not.toHaveBeenCalledWith(expect.stringContaining('Received system message subtype:'))
  })

  it('acknowledges an unhandled system message subtype at debug without emitting chunks', () => {
    const { adapter, parts } = createAdapter()

    const result = adapter.handleMessage({
      type: 'system',
      subtype: 'api_retry',
      session_id: 'sdk-control',
      uuid: crypto.randomUUID()
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([])
    expect(loggerMocks.debug).toHaveBeenCalledWith(
      expect.stringContaining('Received system message subtype: api_retry'),
      expect.anything()
    )
  })

  it('maps thinking token estimates to message metadata', () => {
    const { adapter, parts } = createAdapter()

    const result = adapter.handleMessage({
      type: 'system',
      subtype: 'thinking_tokens',
      session_id: 'sdk-thinking',
      uuid: crypto.randomUUID(),
      estimated_tokens: 100,
      estimated_tokens_delta: 5
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: { thoughtsTokens: 100 }
      }
    ])
  })

  it('maps SDK task system messages to hidden task event data parts', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'task_started',
      session_id: 'sdk-task',
      uuid: 'task-started-uuid',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      description: 'Build launch deck',
      subagent_type: 'general-purpose',
      task_type: 'local_workflow',
      workflow_name: 'deck',
      prompt: 'Create the slides'
    } as any)
    adapter.handleMessage({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'sdk-task',
      uuid: 'task-finished-uuid',
      task_id: 'task-1',
      status: 'completed',
      output_file: '/tmp/task.out',
      summary: 'Build launch deck',
      usage: { total_tokens: 120, tool_uses: 3, duration_ms: 4500 }
    } as any)

    expect(parts).toEqual([
      {
        type: 'data-agent-task-event',
        id: 'task-task-1-started-task-started-uuid',
        data: expect.objectContaining({
          event: 'started',
          taskId: 'task-1',
          toolUseId: 'tool-1',
          status: 'in_progress',
          title: 'Build launch deck',
          subagentType: 'general-purpose'
        })
      },
      {
        type: 'data-agent-task-event',
        id: 'task-task-1-notification-task-finished-uuid',
        data: expect.objectContaining({
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          title: 'Build launch deck',
          outputFile: '/tmp/task.out',
          usage: { totalTokens: 120, toolUses: 3, durationMs: 4500 }
        })
      }
    ])
    expect(loggerMocks.debug).not.toHaveBeenCalledWith(expect.stringContaining('Received system message subtype:'))
  })

  it('maps task_updated through mapTaskStatus non-completed branches (S5)', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'task_updated',
      session_id: 'sdk-task',
      uuid: 'task-updated-failed-uuid',
      task_id: 'task-9',
      patch: { status: 'failed', description: 'Render slides', error: 'render crashed' }
    } as any)
    adapter.handleMessage({
      type: 'system',
      subtype: 'task_updated',
      session_id: 'sdk-task',
      uuid: 'task-updated-running-uuid',
      task_id: 'task-9',
      patch: { status: 'running', description: 'Render slides' }
    } as any)

    expect(parts).toEqual([
      {
        type: 'data-agent-task-event',
        id: 'task-task-9-updated-task-updated-failed-uuid',
        data: expect.objectContaining({
          event: 'updated',
          taskId: 'task-9',
          status: 'error', // mapTaskStatus('failed')
          error: 'render crashed',
          activeText: undefined // only set while in_progress
        })
      },
      {
        type: 'data-agent-task-event',
        id: 'task-task-9-updated-task-updated-running-uuid',
        data: expect.objectContaining({
          event: 'updated',
          status: 'in_progress', // mapTaskStatus('running')
          activeText: 'Render slides'
        })
      }
    ])
  })

  it('maps text content block deltas', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    )
    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))

    expect(parts.map((part) => part.type)).toEqual(['text-start', 'text-delta', 'text-end'])
    expect(parts[1]).toMatchObject({ type: 'text-delta', id: (parts[0] as any).id, delta: 'hi' })
    expect(parts[2]).toMatchObject({ type: 'text-end', id: (parts[0] as any).id })
  })

  it('maps reasoning content block deltas', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
    )
    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))

    expect(parts.map((part) => part.type)).toEqual(['reasoning-start', 'reasoning-delta', 'reasoning-end'])
    expect(parts[1]).toMatchObject({ type: 'reasoning-delta', id: (parts[0] as any).id, delta: 'plan' })
    expect(parts[2]).toMatchObject({ type: 'reasoning-end', id: (parts[0] as any).id })
  })

  it('attaches parent tool metadata to streamed text and reasoning parts', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      ...streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      parent_tool_use_id: 'parent-tool'
    })
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage({
      ...streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }),
      parent_tool_use_id: 'parent-tool'
    })

    expect(parts[0]).toMatchObject({
      type: 'text-start',
      providerMetadata: {
        'claude-code': {
          parentToolCallId: 'parent-tool'
        }
      }
    })
    expect(parts[2]).toMatchObject({
      type: 'reasoning-start',
      providerMetadata: {
        'claude-code': {
          parentToolCallId: 'parent-tool'
        }
      }
    })
  })

  it('maps tool input deltas to tool call parts', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }
      })
    )
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"cmd":"' }
      })
    )
    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'pwd"}' } })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))

    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-delta',
      'tool-input-available'
    ])
    expect(parts[0]).toMatchObject({ type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'Bash' })
    expect(parts[3]).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      input: { cmd: 'pwd' }
    })
  })

  it('maps assistant tool use and user tool result', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: 'a.txt' } }]
      }
    } as any)
    adapter.handleMessage({
      type: 'user',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: '{"ok":true}', is_error: false }]
      }
    } as any)

    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(parts[2]).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'tool-2',
      toolName: 'Read',
      input: { file_path: 'a.txt' }
    })
    expect(parts[3]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'tool-2',
      output: { ok: true }
    })
  })

  it('maps streamed MCP tool use and result blocks', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'mcp_tool_use',
          id: 'mcp-1',
          name: 'search_docs',
          server_name: 'docs',
          input: {}
        }
      })
    )
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"agent sdk"}' }
      })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'mcp_tool_result',
          tool_use_id: 'mcp-1',
          is_error: false,
          content: [{ type: 'text', text: 'result text' }]
        }
      })
    )

    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(parts[0]).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'mcp-1',
      toolName: 'search_docs',
      title: 'docs: search_docs'
    })
    expect(parts[2]).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'mcp-1',
      input: { query: 'agent sdk' }
    })
    expect(parts[3]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'mcp-1',
      output: {
        content: 'result text',
        metadata: { type: 'mcp', serverName: 'docs', serverId: 'docs' }
      }
    })
  })

  it('uses MCP display metadata for Claude Code MCP tool ids', () => {
    const { adapter, parts } = createAdapter({
      mcpToolMetadata: {
        'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id': {
          type: 'mcp',
          serverId: '8171b5f3-c666-4ead-b2ab-bb9ac244af57',
          serverName: 'Context7',
          name: 'resolve-library-id',
          description: 'Resolve a package name into a Context7 library ID.'
        }
      }
    })

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'mcp-approval-1',
          name: 'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id',
          input: {}
        }
      })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))

    expect(parts[0]).toMatchObject({
      type: 'tool-input-start',
      toolName: 'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id',
      title: 'Context7: resolve-library-id',
      providerMetadata: {
        cherry: {
          tool: {
            type: 'mcp',
            serverId: '8171b5f3-c666-4ead-b2ab-bb9ac244af57',
            serverName: 'Context7',
            name: 'resolve-library-id',
            description: 'Resolve a package name into a Context7 library ID.'
          }
        }
      }
    })
    expect(parts[1]).toMatchObject({
      type: 'tool-input-available',
      providerMetadata: {
        cherry: {
          tool: {
            name: 'resolve-library-id',
            description: 'Resolve a package name into a Context7 library ID.'
          }
        }
      }
    })
  })

  it('falls back to parsed MCP tool names when display metadata is unavailable', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'mcp-approval-1',
          name: 'mcp__context7__resolve-library-id',
          input: {}
        }
      })
    )

    expect(parts[0]).toMatchObject({
      type: 'tool-input-start',
      toolName: 'mcp__context7__resolve-library-id',
      title: 'context7: resolve-library-id',
      providerMetadata: {
        cherry: {
          tool: {
            type: 'mcp',
            serverId: 'context7',
            serverName: 'context7',
            name: 'resolve-library-id'
          }
        }
      }
    })
  })

  it('maps assistant server tool use and server tool result blocks', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [
          {
            type: 'server_tool_use',
            id: 'srv-1',
            name: 'web_search',
            input: { query: 'agent sdk' }
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srv-1',
            content: [
              {
                type: 'web_search_result',
                title: 'Docs',
                url: 'https://example.com',
                encrypted_content: '',
                page_age: null
              }
            ]
          }
        ]
      }
    } as any)

    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(parts[2]).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'srv-1',
      toolName: 'web_search',
      input: { query: 'agent sdk' }
    })
    expect(parts[3]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'srv-1',
      output: [{ title: 'Docs', url: 'https://example.com' }]
    })
  })

  it('maps success result to finish metadata', () => {
    const { adapter, parts, sessionIds } = createAdapter()

    const message = successResult()
    const result = adapter.handleMessage(message)

    expect(result).toEqual({ type: 'result', sessionId: 'sdk-result', message })
    expect(sessionIds).toEqual(['sdk-result'])
    expect(parts).toEqual([
      expect.objectContaining({
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: expect.objectContaining({
          modelId: 'sonnet',
          totalTokens: 26,
          promptTokens: 21,
          completionTokens: 5
        })
      })
    ])
  })

  it('throws SDK error results after capturing session id', () => {
    const { adapter, sessionIds } = createAdapter()

    expect(() =>
      adapter.handleMessage(
        successResult({
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['boom'],
          session_id: 'sdk-error'
        })
      )
    ).toThrow('boom')
    expect(sessionIds).toEqual(['sdk-error'])
  })

  it('emits truncation fallback from buffered text', () => {
    const { adapter, parts } = createAdapter()
    const text = 'x'.repeat(600)

    adapter.handleMessage(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
    const handled = adapter.handleTruncationError(new SyntaxError('Unexpected end of JSON input'))

    expect(handled).toBe(true)
    expect(parts.map((part) => part.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    expect(parts[3]).toMatchObject({
      type: 'finish',
      finishReason: 'length',
      messageMetadata: expect.objectContaining({ modelId: 'sonnet' })
    })
  })
})
