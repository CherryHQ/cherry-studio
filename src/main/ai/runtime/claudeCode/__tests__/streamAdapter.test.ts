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

/**
 * The adapter is session-scoped, so content only flows inside a turn. These cases all exercise
 * in-turn behaviour, so the turn is opened by default; pass `openTurn: false` to assert what a
 * turn-less connection does with a message.
 */
function createAdapter(
  overrides: Partial<ConstructorParameters<typeof ClaudeCodeStreamAdapter>[0]> = {},
  { openTurn = true }: { openTurn?: boolean } = {}
) {
  const parts: CherryUIMessageChunk[] = []
  const sessionIds: string[] = []
  const statusEvents: any[] = []
  const adapter = new ClaudeCodeStreamAdapter({
    modelId: 'sonnet',
    sessionId: 'session-1',
    streamOptions: { prompt: [] } as any,
    sink: { enqueue: (part) => parts.push(part) },
    statusSink: { emit: (event) => statusEvents.push(event) },
    onSessionId: (sessionId) => sessionIds.push(sessionId),
    ...overrides
  })
  if (openTurn) adapter.beginTurn()
  return { adapter, parts, sessionIds, statusEvents }
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
      subtype: 'hook_started',
      session_id: 'sdk-control',
      uuid: crypto.randomUUID()
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([])
    expect(loggerMocks.debug).toHaveBeenCalledWith(
      expect.stringContaining('Received system message subtype: hook_started'),
      expect.anything()
    )
  })

  it('drops api_retry silently — the driver intercepts it as an ephemeral runtime event', () => {
    const { adapter, parts } = createAdapter()

    const result = adapter.handleMessage({
      type: 'system',
      subtype: 'api_retry',
      session_id: 'sdk-control',
      uuid: crypto.randomUUID(),
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 1234,
      error_status: 500,
      error: 'server_error'
    } as any)

    expect(result).toEqual({ type: 'continue' })
    expect(parts).toEqual([])
    expect(loggerMocks.debug).not.toHaveBeenCalledWith(expect.stringContaining('Received system message subtype:'))
  })

  it('maps thinking token estimates to a full cumulative metadata snapshot', () => {
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
        messageMetadata: {
          modelId: 'sonnet',
          stats: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            outputTokenDetails: { reasoningTokens: 100 }
          }
        }
      }
    ])
  })

  it('preserves the latest thinking estimate in final usage metadata', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'thinking_tokens',
      session_id: 'sdk-thinking',
      uuid: crypto.randomUUID(),
      estimated_tokens: 100
    } as any)
    adapter.handleMessage(successResult())

    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      messageMetadata: {
        modelId: 'sonnet',
        stats: {
          inputTokens: 21,
          outputTokens: 5,
          totalTokens: 26,
          outputTokenDetails: { reasoningTokens: 100 }
        }
      }
    })
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
          // The summary is prose, so it is carried as `summary` only — consumers keep the
          // started-event title for the row.
          summary: 'Build launch deck',
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

  it('maps a stopped task notification to a neutral terminal status', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'task_notification',
      session_id: 'sdk-task',
      uuid: 'task-stopped-uuid',
      task_id: 'task-1',
      status: 'stopped',
      summary: 'Stopped by user'
    } as any)

    expect(parts).toEqual([
      {
        type: 'data-agent-task-event',
        id: 'task-task-1-notification-task-stopped-uuid',
        data: expect.objectContaining({
          event: 'notification',
          taskId: 'task-1',
          status: 'stopped'
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

  it('keeps JSON text MCP tool results parsed for dedicated tool cards', () => {
    const { adapter, parts } = createAdapter()
    const results = [{ id: 1, title: 'Cherry Studio', url: 'https://example.com', content: 'result' }]

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'mcp_tool_use',
          id: 'mcp-search',
          name: 'web_search',
          server_name: 'cherry-tools',
          input: { query: 'Cherry Studio' }
        }
      })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'mcp_tool_result',
          tool_use_id: 'mcp-search',
          is_error: false,
          content: [{ type: 'text', text: JSON.stringify(results) }]
        }
      })
    )

    expect(parts.at(-1)).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'mcp-search',
      output: {
        content: results,
        metadata: { type: 'mcp', serverName: 'cherry-tools', serverId: 'cherry-tools' }
      }
    })
  })

  it('normalizes Claude MCP image tool results to MCP content blocks', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'mcp_tool_use',
          id: 'mcp-image',
          name: 'config',
          server_name: 'cherry-tools',
          input: {}
        }
      })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'mcp_tool_result',
          tool_use_id: 'mcp-image',
          is_error: false,
          content: [
            { type: 'text', text: 'QR code generated' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }
            }
          ]
        }
      })
    )

    expect(parts.at(-1)).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'mcp-image',
      output: {
        content: [
          { type: 'text', text: 'QR code generated' },
          { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
        ],
        metadata: { type: 'mcp', serverName: 'cherry-tools', serverId: 'cherry-tools' }
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
        // v6 semantic: stats.inputTokens = TOTAL input incl. cache (3 + 7 + 11 = 21);
        // the breakdown lives in inputTokenDetails; totalTokens is the all-in
        // figure (21 + 5 = 26).
        messageMetadata: expect.objectContaining({
          modelId: 'sonnet',
          stats: expect.objectContaining({
            inputTokens: 21,
            outputTokens: 5,
            totalTokens: 26,
            inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 11, cacheWriteTokens: 7 }
          })
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

  it('emits final live usage metadata before throwing on error results', () => {
    const { adapter, parts } = createAdapter()

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

    // The driver never reaches `emitUsageMetadata` on a throw, so the adapter must flush the final
    // live token snapshot itself. Invocation-record capture is a separate driver responsibility.
    expect(parts).toEqual([
      {
        type: 'message-metadata',
        messageMetadata: {
          modelId: 'sonnet',
          stats: {
            inputTokens: 21,
            outputTokens: 5,
            totalTokens: 26,
            inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 11, cacheWriteTokens: 7 }
          }
        }
      }
    ])
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

  it('treats an aborted assistant message as truncation even when the error is not a parse failure', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } })
    )
    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      aborted: true,
      message: { content: [{ type: 'text', text: 'hi' }] }
    } as any)

    // Short text and a non-SyntaxError: the string heuristic alone would return false.
    const handled = adapter.handleTruncationError(new Error('stream closed'))

    expect(handled).toBe(true)
    expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: 'length' })
  })

  it('does not report truncation for a normal error when no message was aborted', () => {
    const { adapter } = createAdapter()

    expect(adapter.handleTruncationError(new Error('stream closed'))).toBe(false)
  })

  it('reports an auto-denied tool call as denied rather than failed', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'tool_use', id: 'tool-9', name: 'Bash', input: { command: 'rm -rf /' } }]
      }
    } as any)
    adapter.handleMessage({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'tool-9',
      decision_reason_type: 'rule',
      message: 'Permission to use Bash has been denied.',
      uuid: crypto.randomUUID(),
      session_id: 'sdk-1'
    } as any)
    adapter.handleMessage({
      type: 'user',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-9',
            content: 'Permission to use Bash has been denied.',
            is_error: true
          }
        ]
      }
    } as any)

    // `is_error: true` would otherwise render as a generic tool failure.
    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-denied'
    ])
    // The chunk schema is strict: only `toolCallId` may accompany the type.
    expect(parts.at(-1)).toEqual({ type: 'tool-output-denied', toolCallId: 'tool-9' })
  })

  it('still reports a genuine tool failure as an error', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'user',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-10', content: 'boom', is_error: true }]
      }
    } as any)

    expect(parts.map((part) => part.type)).toContain('tool-output-error')
    expect(parts.map((part) => part.type)).not.toContain('tool-output-denied')
  })

  // The adapter now lives for the whole connection, so a turn must start from clean state. This is
  // the guarantee `createTurnContext` exists for — resetting fields individually would leak whichever
  // one a later change forgets.
  describe('session-scoped lifecycle', () => {
    it('starts each turn from clean state instead of carrying the previous one', () => {
      const { adapter, parts } = createAdapter()

      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first turn' } })
      )
      adapter.handleMessage(successResult())
      const firstTurnParts = parts.length

      adapter.beginTurn()
      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'second' } })
      )

      // A leaked `streamedTextLength` / `accumulatedText` would make the second turn emit a delta
      // diffed against the first turn's text instead of the whole string.
      const secondTurnParts = parts.slice(firstTurnParts)
      expect(secondTurnParts.some((part) => part.type === 'text-delta' && part.delta === 'second')).toBe(true)
    })

    it('keeps a subagent flow context alive after the spawning main turn completes', () => {
      const { adapter, parts, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: 'task-root',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: {
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/a.ts' } }]
        }
      } as any)
      adapter.handleMessage(successResult())
      const mainPartCount = parts.length

      adapter.handleMessage({
        type: 'user',
        parent_tool_use_id: 'task-root',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'source text' }]
        }
      } as any)

      expect(parts).toHaveLength(mainPartCount)
      expect(statusEvents).toContainEqual({
        type: 'background-flow-chunk',
        rootToolCallId: 'task-root',
        chunk: expect.objectContaining({
          type: 'tool-output-available',
          toolCallId: 'read-1'
        })
      })
    })

    it('routes parented content to the detached FlowTab stream when no main turn is open', () => {
      const { adapter, parts, statusEvents } = createAdapter({}, { openTurn: false })

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: 'task-9',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: { content: [{ type: 'text', text: 'background result' }] }
      } as any)

      expect(parts).toEqual([])
      expect(statusEvents).toEqual([
        expect.objectContaining({
          type: 'background-flow-chunk',
          rootToolCallId: 'task-9',
          chunk: expect.objectContaining({ type: 'text-start' })
        }),
        expect.objectContaining({
          type: 'background-flow-chunk',
          rootToolCallId: 'task-9',
          chunk: expect.objectContaining({ type: 'text-delta', delta: 'background result' })
        })
      ])
    })

    it('advances the resume token but reports no turn to complete for a stray result', () => {
      const { adapter, parts, sessionIds } = createAdapter({}, { openTurn: false })

      const result = adapter.handleMessage(successResult({ session_id: 'resume-stray' }))

      expect(result).toEqual({ type: 'continue' })
      expect(sessionIds).toEqual(['resume-stray'])
      expect(parts).toEqual([])
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'Received a result message with no active turn; dropping turn-complete',
        { sessionId: 'session-1' }
      )
    })

    // The whole point of the second output: background work outlives its turn, so its signals must
    // still reach the host once that turn's message stream is gone.
    it('reports session status through the status sink with no turn open', () => {
      const { adapter, parts, statusEvents } = createAdapter({}, { openTurn: false })

      const tasks = [{ task_id: 'bg-1', task_type: 'local_bash', description: 'sleep 300' }]
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'commands_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        commands: [{ name: 'help', description: 'Help' }]
      } as any)

      expect(statusEvents).toEqual([
        {
          type: 'background-tasks',
          tasks: [{ id: 'bg-1', type: 'local_bash', description: 'sleep 300' }]
        },
        { type: 'background-work-state', active: true },
        { type: 'supported-commands', commands: [{ name: 'help', description: 'Help' }] }
      ])
      // Status is not turn content, so nothing reaches the message stream.
      expect(parts).toEqual([])
    })

    it('enriches the authoritative task level from an explicit async launch receipt', () => {
      const { adapter, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-use-b',
              name: 'Agent',
              input: { description: 'Current task B', prompt: 'Audit the codebase' }
            }
          ]
        }
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'subagent-b', task_type: 'subagent', description: 'Current task B' }]
      } as any)
      adapter.handleMessage({
        type: 'user',
        parent_tool_use_id: null,
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-use-b',
              content: JSON.stringify({
                status: 'async_launched',
                agentId: 'subagent-b',
                description: 'Current task B'
              }),
              is_error: false
            }
          ]
        }
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks')).toEqual([
        {
          type: 'background-tasks',
          tasks: [{ id: 'subagent-b', type: 'subagent', description: 'Current task B' }]
        },
        {
          type: 'background-tasks',
          tasks: [
            {
              id: 'subagent-b',
              type: 'subagent',
              description: 'Current task B',
              toolCallId: 'tool-use-b'
            }
          ]
        }
      ])
    })

    it('uses subagent edges only to enrich navigation without changing authoritative membership', () => {
      const { adapter, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'subagent-b', task_type: 'subagent', description: 'Current task B' }]
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'subagent-a',
        tool_use_id: 'stale-tool-use-a',
        description: 'Stale task A',
        task_type: 'subagent'
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'subagent-b',
        tool_use_id: 'tool-use-b',
        description: 'Current task B',
        task_type: 'subagent'
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks')).toEqual([
        {
          type: 'background-tasks',
          tasks: [{ id: 'subagent-b', type: 'subagent', description: 'Current task B' }]
        },
        {
          type: 'background-tasks',
          tasks: [
            {
              id: 'subagent-b',
              type: 'subagent',
              description: 'Current task B',
              toolCallId: 'tool-use-b'
            }
          ]
        }
      ])
    })

    it('releases background keepalive after the terminal bookend and idle without requiring a wake', () => {
      const { adapter, statusEvents } = createAdapter({}, { openTurn: false })
      const task = { task_id: 'bg-1', task_type: 'subagent', description: 'Audit the codebase' }

      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [task]
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'session_state_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        state: 'idle'
      } as any)
      // A foreground turn can become idle while its detached task is still live.
      expect(statusEvents).not.toContainEqual({ type: 'background-work-state', active: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: []
      } as any)

      // Empty membership is delivered before the terminal edge in practice and is not quiescence.
      expect(statusEvents.at(-1)).toEqual({ type: 'background-tasks', tasks: [] })
      expect(statusEvents).not.toContainEqual({ type: 'background-work-state', active: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'task_notification',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'bg-1',
        status: 'completed',
        output_file: '/tmp/bg-1.md',
        summary: 'Audited the codebase'
      } as any)
      expect(statusEvents.at(-1)).toMatchObject({
        type: 'background-task-event',
        data: { event: 'notification', taskId: 'bg-1', status: 'completed' }
      })
      expect(statusEvents).not.toContainEqual({ type: 'background-work-state', active: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'session_state_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        state: 'idle'
      } as any)
      expect(statusEvents.at(-1)).toEqual({ type: 'background-work-state', active: false })
    })

    it('keeps background work alive through a terminal bookend and parentless wake until idle', () => {
      const { adapter, statusEvents } = createAdapter({}, { openTurn: false })
      const task = { task_id: 'bg-1', task_type: 'subagent', description: 'Audit the codebase' }

      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [task]
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: []
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'task_notification',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'bg-1',
        status: 'completed',
        output_file: '/tmp/bg-1.md',
        summary: 'Audited the codebase'
      } as any)
      adapter.handleMessage({
        ...streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }),
        parent_tool_use_id: null
      })
      adapter.handleMessage(successResult())

      expect(statusEvents.map((event) => event.type)).toEqual([
        'background-tasks',
        'background-work-state',
        'background-tasks',
        'background-task-event',
        'autonomous-generation-state',
        'receive-only-turn',
        'autonomous-generation-state'
      ])
      expect(statusEvents).not.toContainEqual({ type: 'background-work-state', active: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'session_state_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        state: 'idle'
      } as any)
      expect(statusEvents.at(-1)).toEqual({ type: 'background-work-state', active: false })
    })

    it('reports compaction through the status sink, including a boundary anchor', () => {
      const { adapter, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        status: 'compacting'
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        compact_metadata: { trigger: 'auto', pre_tokens: 50_000, post_tokens: 12_000, duration_ms: 900 }
      } as any)

      expect(statusEvents).toEqual([
        { type: 'compaction-start' },
        {
          type: 'compaction-complete',
          anchor: expect.objectContaining({ trigger: 'auto', preTokens: 50_000, postTokens: 12_000, durationMs: 900 })
        }
      ])
    })

    it('settles a compaction that reports success without a boundary', () => {
      const { adapter, statusEvents } = createAdapter()

      // The SDK does not guarantee a boundary, so success alone must clear the compacting state.
      adapter.handleMessage({
        type: 'system',
        subtype: 'status',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        compact_result: 'success'
      } as any)

      expect(statusEvents).toEqual([{ type: 'compaction-complete' }])
    })

    // The bug this whole refactor exists for: a background task's completion used to be dropped,
    // leaving its row running forever.
    it('reports task lifecycle as status once the spawning turn has ended', () => {
      const { adapter, parts, statusEvents } = createAdapter({}, { openTurn: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'task_notification',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'bg-1',
        status: 'completed',
        output_file: '/tmp/bg-1.md',
        summary: 'Audited the codebase',
        usage: { total_tokens: 120, tool_uses: 3, duration_ms: 4500 }
      } as any)

      expect(parts).toEqual([])
      expect(statusEvents).toEqual([
        {
          type: 'background-task-event',
          data: expect.objectContaining({ taskId: 'bg-1', event: 'notification', status: 'completed' })
        }
      ])
    })

    it('keeps task lifecycle in the transcript and current-process task surface while a turn is open', () => {
      const { adapter, parts, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'sdk-1',
        uuid: 'started-uuid',
        task_id: 'bg-1',
        description: 'Audit the codebase'
      } as any)

      // In-turn events stay parts for history and also update the process-scoped liveness surface.
      expect(statusEvents).toEqual([
        {
          type: 'background-task-event',
          data: expect.objectContaining({ taskId: 'bg-1', event: 'started', status: 'in_progress' })
        }
      ])
      expect(parts).toEqual([expect.objectContaining({ type: 'data-agent-task-event' })])
    })

    it('maps the per-task background transition without correlating the aggregate level', () => {
      const { adapter, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'system',
        subtype: 'task_updated',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'edge-task-1',
        patch: { status: 'running', is_backgrounded: true }
      } as any)

      expect(statusEvents).toEqual([
        {
          type: 'background-task-event',
          data: expect.objectContaining({
            taskId: 'edge-task-1',
            status: 'in_progress',
            isBackgrounded: true
          })
        }
      ])
    })

    // Claude wakes the main agent after background work completes. The adapter keeps that native
    // protocol here and exposes a runtime-neutral receive-only turn to the host.
    it('self-arms on parentless content and reports a receive-only turn before any chunk', () => {
      const { adapter, parts, statusEvents } = createAdapter({}, { openTurn: false })

      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'woke up' } })
      )

      expect(statusEvents).toEqual([
        { type: 'autonomous-generation-state', active: true },
        { type: 'receive-only-turn' }
      ])
      expect(parts.some((part) => part.type === 'text-delta' && part.delta === 'woke up')).toBe(true)
      expect(adapter.isTurnActive).toBe(true)
    })

    it('releases autonomous ownership when a receive-only generation completes', () => {
      const { adapter, statusEvents } = createAdapter({}, { openTurn: false })

      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'summary' } })
      )
      const result = adapter.handleMessage(successResult({ session_id: 'resume-wake' }))

      expect(result).toMatchObject({ type: 'result', sessionId: 'resume-wake' })
      expect(statusEvents).toEqual([
        { type: 'autonomous-generation-state', active: true },
        { type: 'receive-only-turn' },
        { type: 'autonomous-generation-state', active: false }
      ])
      expect(loggerMocks.warn).not.toHaveBeenCalledWith(
        'Received a result message with no active turn; dropping turn-complete',
        expect.anything()
      )
    })

    it('does not wake the main agent for parented content and routes it to FlowTab instead', () => {
      const { adapter, parts, statusEvents } = createAdapter({}, { openTurn: false })

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: 'task-1',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: { content: [{ type: 'text', text: 'subagent internals' }] }
      } as any)

      expect(statusEvents).toEqual([
        expect.objectContaining({
          type: 'background-flow-chunk',
          rootToolCallId: 'task-1',
          chunk: expect.objectContaining({ type: 'text-start' })
        }),
        expect.objectContaining({
          type: 'background-flow-chunk',
          rootToolCallId: 'task-1',
          chunk: expect.objectContaining({ type: 'text-delta', delta: 'subagent internals' })
        })
      ])
      expect(parts).toEqual([])
      expect(statusEvents).not.toContainEqual({ type: 'receive-only-turn' })
    })

    it('holds init metadata until a turn opens, since it is turn content', () => {
      const { adapter, parts, sessionIds } = createAdapter({}, { openTurn: false })

      adapter.handleMessage({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-primed',
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

      // The resume token is session state and applies at once; the metadata chunk waits for a turn.
      expect(sessionIds).toEqual(['sdk-primed'])
      expect(parts).toEqual([])

      adapter.beginTurn()

      expect(parts).toEqual([
        expect.objectContaining({ type: 'message-metadata', messageMetadata: { modelId: 'sonnet' } })
      ])
    })
  })
})
