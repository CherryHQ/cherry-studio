import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { readUIMessageStream } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMocks = vi.hoisted(() => ({
  silly: vi.fn(),
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

const { ClaudeCodeResultError, ClaudeCodeStreamAdapter } = await import('../streamAdapter')
const { PersistenceListener } = await import('../../../streamManager/listeners/PersistenceListener')
const adapters = new Set<InstanceType<typeof ClaudeCodeStreamAdapter>>()

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.mocked(application.getPath).mockReturnValue(tmpdir())
})

afterEach(() => {
  for (const adapter of adapters) adapter.dispose()
  adapters.clear()
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
  adapters.add(adapter)
  if (openTurn) adapter.beginTurn()
  return { adapter, parts, sessionIds, statusEvents }
}

function getLastBackgroundTaskEvent(statusEvents: any[]) {
  return statusEvents.filter((event) => event.type === 'background-task-event').at(-1)
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

function createWorkflowFixture() {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'cherry-workflow-'))
  const runId = 'wf_safe-123'
  const taskId = 'workflow-task-1'
  const transcriptDir = path.join(projectRoot, 'subagents', 'workflows', runId)
  const snapshotPath = path.join(projectRoot, 'workflows', `${runId}.json`)
  const script = `export const meta = {
  name: 'review-pr',
  description: 'Review a pull request',
  phases: [
    { title: 'Review', detail: 'Inspect the change' },
    { title: 'Verify', detail: 'Check the findings' },
  ],
}

phase('Review')
const review = await agent('Review the change', { label: 'reviewer:main', phase: 'Review' })
phase('Verify')
return agent(\`Verify \${review}\`, { label: 'verifier:main', phase: 'Verify' })`
  mkdirSync(transcriptDir, { recursive: true })
  mkdirSync(path.dirname(snapshotPath), { recursive: true })

  return {
    projectRoot,
    runId,
    taskId,
    transcriptDir,
    snapshotPath,
    script,
    writeSnapshot: (overrides: Record<string, unknown> = {}) =>
      writeFileSync(
        snapshotPath,
        JSON.stringify({
          runId,
          taskId,
          workflowName: 'review-pr',
          durationMs: 1000,
          phases: [{ title: 'Review' }],
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'review:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'running',
              tokens: 120,
              toolCalls: 3,
              durationMs: 900
            }
          ],
          totalTokens: 120,
          totalToolCalls: 3,
          ...overrides
        })
      ),
    cleanup: () => rmSync(projectRoot, { recursive: true, force: true })
  }
}

function createBackgroundBashFixture(taskId = 'bash-1', sessionId = 'sdk-1') {
  const claudeRoot = path.join(tmpdir(), 'claude')
  mkdirSync(claudeRoot, { recursive: true })
  const cwdDir = mkdtempSync(path.join(realpathSync(claudeRoot), 'cherry-test-'))
  const tasksDir = path.join(cwdDir, sessionId, 'tasks')
  const outputFile = path.join(tasksDir, `${taskId}.output`)
  mkdirSync(tasksDir, { recursive: true })
  writeFileSync(outputFile, '')

  return {
    taskId,
    sessionId,
    cwdDir,
    outputFile,
    receipt: (receiptTaskId = taskId, receiptOutputFile = outputFile) =>
      `Command running in background with ID: ${receiptTaskId}. Output is being written to: ${receiptOutputFile}. You can continue working while it runs.`,
    writeOutput: (output: string) => writeFileSync(outputFile, output),
    appendOutput: (output: string) => appendFileSync(outputFile, output),
    cleanup: () => rmSync(cwdDir, { recursive: true, force: true })
  }
}

function createAgentFixture(agentId = 'agent-1', sessionId = 'sdk-agent') {
  return {
    agentId,
    sessionId,
    outputFile: path.join(tmpdir(), 'claude', sessionId, 'tasks', `${agentId}.output`)
  }
}

function appendAssistantTranscriptStep(
  transcriptPath: string,
  messageId: string,
  inputTokens: number,
  outputTokens: number,
  toolUses: Array<{ id: string; type?: 'tool_use' | 'server_tool_use' | 'mcp_tool_use' }> = []
) {
  appendFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: 'assistant',
      uuid: crypto.randomUUID(),
      parentUuid: crypto.randomUUID(),
      message: {
        id: messageId,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        },
        content: toolUses.map((tool) => ({
          type: tool.type ?? 'tool_use',
          id: tool.id,
          name: 'Read',
          input: {}
        }))
      }
    })}\n`
  )
}

function createAgentTranscriptFixture(agentId = 'agent-1', sessionId = 'sdk-agent') {
  const claudeConfigDir = mkdtempSync(path.join(tmpdir(), 'cherry-agent-transcript-'))
  const projectDir = path.join(claudeConfigDir, 'projects', 'D--workspace')
  const transcriptDir = path.join(projectDir, sessionId, 'subagents')
  const transcriptPath = path.join(transcriptDir, `agent-${agentId}.jsonl`)
  mkdirSync(transcriptDir, { recursive: true })
  writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'queue-operation' })}\n`)
  writeFileSync(transcriptPath, '')

  return {
    ...createAgentFixture(agentId, sessionId),
    claudeConfigDir,
    transcriptPath,
    appendAssistantStep: (
      messageId: string,
      inputTokens: number,
      outputTokens: number,
      toolUses: Array<{ id: string; type?: 'tool_use' | 'server_tool_use' | 'mcp_tool_use' }> = []
    ) => appendAssistantTranscriptStep(transcriptPath, messageId, inputTokens, outputTokens, toolUses),
    cleanup: () => rmSync(claudeConfigDir, { recursive: true, force: true })
  }
}

function emitAgentToolCall(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  toolCallId = 'agent-tool-use'
) {
  adapter.handleMessage({
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolCallId,
          name: 'Agent',
          input: { description: 'Inspect task state', prompt: 'Inspect the task projection' }
        }
      ]
    }
  } as any)
}

function launchAgent(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  toolCallId = 'agent-tool-use'
) {
  emitAgentToolCall(adapter, fixture, toolCallId)
  adapter.handleMessage({
    type: 'user',
    parent_tool_use_id: null,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: 'Async agent launched successfully.',
          is_error: false
        }
      ]
    },
    tool_use_result: {
      status: 'async_launched',
      agentId: fixture.agentId,
      description: 'Inspect task state',
      prompt: 'Inspect the task projection',
      outputFile: fixture.outputFile
    }
  } as any)
}

function startAgentTask(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  { backgrounded = false, toolCallId = 'agent-tool-use' }: { backgrounded?: boolean; toolCallId?: string } = {}
) {
  if (backgrounded) launchAgent(adapter, fixture, toolCallId)
  else emitAgentToolCall(adapter, fixture, toolCallId)
  adapter.handleMessage({
    type: 'system',
    subtype: 'task_started',
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    task_id: fixture.agentId,
    tool_use_id: toolCallId,
    description: 'Inspect task state',
    subagent_type: 'general-purpose',
    task_type: 'local_agent'
  } as any)
}

function emitForwardedAgentStep(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  {
    messageId,
    inputTokens,
    outputTokens,
    toolIds = [],
    toolCallId = 'agent-tool-use'
  }: {
    messageId: string
    inputTokens: number
    outputTokens: number
    toolIds?: string[]
    toolCallId?: string
  }
) {
  adapter.handleMessage({
    type: 'assistant',
    parent_tool_use_id: toolCallId,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      id: messageId,
      usage: {
        input_tokens: inputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: outputTokens
      },
      content: toolIds.map((id) => ({ type: 'tool_use', id, name: 'Read', input: {} }))
    }
  } as any)
}

function emitAgentProgress(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  {
    description,
    durationMs,
    toolUses = 0,
    totalTokens = 0,
    toolCallId = 'agent-tool-use'
  }: {
    description: string
    durationMs: number
    toolUses?: number
    totalTokens?: number
    toolCallId?: string
  }
) {
  adapter.handleMessage({
    type: 'system',
    subtype: 'task_progress',
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    task_id: fixture.agentId,
    tool_use_id: toolCallId,
    description,
    usage: { total_tokens: totalTokens, tool_uses: toolUses, duration_ms: durationMs }
  } as any)
}

function completeForegroundAgent(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  {
    contextTokens,
    durationMs,
    toolUses,
    toolCallId = 'agent-tool-use'
  }: { contextTokens: number; durationMs: number; toolUses: number; toolCallId?: string }
) {
  adapter.handleMessage({
    type: 'user',
    parent_tool_use_id: null,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolCallId, content: 'Inspection complete', is_error: false }]
    },
    tool_use_result: {
      status: 'completed',
      agentId: fixture.agentId,
      totalTokens: contextTokens,
      totalToolUseCount: toolUses,
      totalDurationMs: durationMs
    }
  } as any)
}

function completeBackgroundAgent(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createAgentFixture>,
  {
    contextTokens,
    durationMs,
    toolUses,
    toolCallId = 'agent-tool-use'
  }: { contextTokens: number; durationMs: number; toolUses: number; toolCallId?: string }
) {
  adapter.handleMessage({
    type: 'system',
    subtype: 'task_notification',
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    task_id: fixture.agentId,
    tool_use_id: toolCallId,
    status: 'completed',
    output_file: fixture.outputFile,
    summary: 'Inspection complete',
    usage: { total_tokens: contextTokens, tool_uses: toolUses, duration_ms: durationMs }
  } as any)
}

function launchBackgroundBash(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createBackgroundBashFixture>,
  {
    toolCallId = 'bash-tool-use',
    receiptTaskId = fixture.taskId,
    receiptOutputFile = fixture.outputFile,
    structuredTaskId = fixture.taskId,
    toolResultContent
  }: {
    toolCallId?: string
    receiptTaskId?: string
    receiptOutputFile?: string
    structuredTaskId?: string
    toolResultContent?: unknown
  } = {}
) {
  adapter.handleMessage({
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolCallId,
          name: 'Bash',
          input: { command: 'pnpm dev', description: 'Start the development server', run_in_background: true }
        }
      ]
    }
  } as any)
  adapter.handleMessage({
    type: 'system',
    subtype: 'background_tasks_changed',
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    tasks: [{ task_id: fixture.taskId, task_type: 'local_bash', description: 'Start the development server' }]
  } as any)
  adapter.handleMessage({
    type: 'user',
    parent_tool_use_id: null,
    session_id: fixture.sessionId,
    uuid: crypto.randomUUID(),
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: toolResultContent ?? [
            { type: 'text', text: 'Background command accepted.' },
            { type: 'text', text: fixture.receipt(receiptTaskId, receiptOutputFile) }
          ],
          is_error: false
        }
      ]
    },
    tool_use_result: {
      stdout: fixture.receipt(receiptTaskId, receiptOutputFile),
      stderr: '',
      interrupted: false,
      backgroundTaskId: structuredTaskId
    }
  } as any)
}

function launchWorkflow(
  adapter: InstanceType<typeof ClaudeCodeStreamAdapter>,
  fixture: ReturnType<typeof createWorkflowFixture>,
  overrides: Record<string, unknown> = {}
) {
  adapter.handleMessage({
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: 'sdk-1',
    uuid: crypto.randomUUID(),
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'workflow-tool-use',
          name: 'Workflow',
          input: { name: 'review-pr' }
        }
      ]
    }
  } as any)
  adapter.handleMessage({
    type: 'user',
    parent_tool_use_id: null,
    session_id: 'sdk-1',
    uuid: crypto.randomUUID(),
    timestamp: '2026-08-12T08:00:00.000Z',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'workflow-tool-use',
          content: 'Workflow launched in background',
          is_error: false
        }
      ]
    },
    tool_use_result: {
      status: 'async_launched',
      taskId: fixture.taskId,
      taskType: 'local_workflow',
      workflowName: 'review-pr',
      runId: fixture.runId,
      transcriptDir: fixture.transcriptDir,
      ...overrides
    }
  } as any)
}

describe('ClaudeCodeStreamAdapter', () => {
  describe('turn activity', () => {
    it('starts inactive and ignores metadata chunks', () => {
      const { adapter } = createAdapter()

      expect(adapter.hasTurnActivity).toBe(false)

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

      expect(adapter.hasTurnActivity).toBe(false)
    })

    it('tracks text chunks and resets when the next turn begins', () => {
      const { adapter } = createAdapter()

      adapter.handleMessage(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } })
      )
      expect(adapter.hasTurnActivity).toBe(true)

      adapter.beginTurn()
      expect(adapter.hasTurnActivity).toBe(false)
    })

    it('tracks tool-use chunks emitted by a parented assistant flow', () => {
      const { adapter } = createAdapter()

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: 'workflow-root',
        uuid: crypto.randomUUID(),
        session_id: 'sdk-1',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.ts' } }]
        }
      } as any)

      expect(adapter.hasTurnActivity).toBe(true)
    })

    it('remains inactive when an error result emits only usage metadata', () => {
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

      expect(parts.map((part) => part.type)).toEqual(['message-metadata'])
      expect(adapter.hasTurnActivity).toBe(false)
    })
  })

  it('logs every SDK envelope with correlation ids but without text or tool input', () => {
    const { adapter } = createAdapter()

    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: 'workflow-agent-1',
      uuid: 'message-1',
      session_id: 'sdk-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'sensitive response' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: '/sensitive/path' }
          }
        ]
      }
    } as any)

    expect(loggerMocks.silly).toHaveBeenCalledWith('Received Claude Code SDK event', {
      sessionId: 'session-1',
      event: {
        type: 'assistant',
        uuid: 'message-1',
        sdkSessionId: 'sdk-1',
        parent_tool_use_id: 'workflow-agent-1',
        contentBlocks: [{ type: 'text' }, { type: 'tool_use', id: 'tool-1', name: 'Read' }]
      }
    })
    expect(JSON.stringify(loggerMocks.silly.mock.calls)).not.toContain('sensitive')
  })

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
        id: 'task-task-1-started',
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
        id: 'task-task-1-notification',
        data: expect.objectContaining({
          event: 'notification',
          taskId: 'task-1',
          status: 'completed',
          // The summary is prose, so it is carried as `summary` only — consumers keep the
          // started-event title for the row.
          summary: 'Build launch deck',
          outputFile: '/tmp/task.out',
          usage: { contextTokens: 120, toolUses: 3, durationMs: 4500 }
        })
      }
    ])
    expect(loggerMocks.debug).not.toHaveBeenCalledWith(expect.stringContaining('Received system message subtype:'))
  })

  it('updates a foreground Agent from forwarded messages and maps completed totalTokens to context size', () => {
    const fixture = createAgentFixture()
    const { adapter, statusEvents } = createAdapter()
    startAgentTask(adapter, fixture)

    const firstStep = { messageId: 'message-1', inputTokens: 100, outputTokens: 20, toolIds: ['tool-1'] }
    emitForwardedAgentStep(adapter, fixture, firstStep)
    emitForwardedAgentStep(adapter, fixture, firstStep)
    expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage).toEqual({
      totalTokens: 120,
      contextTokens: 120,
      toolUses: 1
    })

    emitForwardedAgentStep(adapter, fixture, {
      messageId: 'message-2',
      inputTokens: 200,
      outputTokens: 30,
      toolIds: ['tool-2', 'tool-3', 'tool-4', 'tool-5']
    })
    emitAgentProgress(adapter, fixture, {
      description: 'Checking the projection',
      totalTokens: 1000,
      toolUses: 3,
      durationMs: 2000
    })
    expect(statusEvents.at(-1)?.data.usage).toEqual({
      totalTokens: 350,
      contextTokens: 230,
      toolUses: 5,
      durationMs: 2000
    })

    completeForegroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 4, durationMs: 3000 })
    expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
      taskId: fixture.agentId,
      event: 'notification',
      status: 'completed',
      usage: { totalTokens: 350, contextTokens: 240, toolUses: 4, durationMs: 3000 }
    })
  })

  it('updates a background Agent from forwarded messages and final task notification', () => {
    const fixture = createAgentFixture('agent-background')
    const { adapter, statusEvents } = createAdapter()
    startAgentTask(adapter, fixture, { backgrounded: true })
    emitForwardedAgentStep(adapter, fixture, {
      messageId: 'message-background-1',
      inputTokens: 100,
      outputTokens: 20,
      toolIds: ['tool-background-1', 'tool-background-2', 'tool-background-3', 'tool-background-4']
    })
    completeBackgroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 3, durationMs: 3000 })

    expect(statusEvents.at(-1)?.data.usage).toEqual({
      totalTokens: 120,
      contextTokens: 240,
      toolUses: 3,
      durationMs: 3000
    })
  })

  it('reads running foreground Agent usage from its standard subagent transcript', () => {
    const fixture = createAgentTranscriptFixture()
    try {
      const { adapter, statusEvents } = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      startAgentTask(adapter, fixture)

      fixture.appendAssistantStep('message-1', 100, 20, [{ id: 'tool-1' }])
      emitAgentProgress(adapter, fixture, { description: 'Reading the implementation', durationMs: 1000 })
      expect(statusEvents.at(-1)?.data.usage).toEqual({
        totalTokens: 120,
        contextTokens: 120,
        toolUses: 1,
        durationMs: 1000
      })

      fixture.appendAssistantStep('message-2', 200, 30, [
        { id: 'tool-2' },
        { id: 'tool-3' },
        { id: 'tool-4' },
        { id: 'tool-5' }
      ])
      emitAgentProgress(adapter, fixture, { description: 'Checking the projection', durationMs: 2000 })
      expect(statusEvents.at(-1)?.data.usage).toEqual({
        totalTokens: 350,
        contextTokens: 230,
        toolUses: 5,
        durationMs: 2000
      })

      completeForegroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 4, durationMs: 3000 })
      expect(statusEvents.at(-1)?.data.usage).toEqual({
        totalTokens: 350,
        contextTokens: 240,
        toolUses: 4,
        durationMs: 3000
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reconciles the final foreground Agent step after completion races its transcript write', () => {
    vi.useFakeTimers()
    const fixture = createAgentTranscriptFixture('agent-foreground-terminal-race')
    let adapter: InstanceType<typeof ClaudeCodeStreamAdapter> | undefined
    try {
      const created = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      adapter = created.adapter
      const { statusEvents } = created
      startAgentTask(adapter, fixture)

      fixture.appendAssistantStep('message-1', 100, 20, [{ id: 'tool-1' }])
      emitAgentProgress(adapter, fixture, { description: 'Reading the implementation', durationMs: 1000 })
      completeForegroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 2, durationMs: 3000 })
      expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage).toEqual({
        totalTokens: 120,
        contextTokens: 240,
        toolUses: 2,
        durationMs: 3000
      })

      fixture.appendAssistantStep('message-2', 200, 30, [{ id: 'tool-2' }])
      adapter.handleMessage(successResult({ session_id: fixture.sessionId }))
      adapter.handleMessage({
        type: 'system',
        subtype: 'session_state_changed',
        session_id: fixture.sessionId,
        uuid: crypto.randomUUID(),
        state: 'idle'
      } as any)
      vi.advanceTimersByTime(999)
      expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage?.totalTokens).toBe(120)

      vi.advanceTimersByTime(1)
      expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
        event: 'notification',
        taskId: fixture.agentId,
        status: 'completed',
        usage: { totalTokens: 350, contextTokens: 240, toolUses: 2, durationMs: 3000 }
      })
    } finally {
      adapter?.dispose()
      fixture.cleanup()
      vi.useRealTimers()
    }
  })

  it('refreshes foreground Agent usage from its transcript when progress races the JSONL write', () => {
    const fixture = createAgentTranscriptFixture('agent-racing-progress')
    try {
      const { adapter, parts, statusEvents } = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      startAgentTask(adapter, fixture)
      emitAgentProgress(adapter, fixture, { description: 'Reading the implementation', durationMs: 1000 })

      fixture.appendAssistantStep('message-after-progress', 100, 20, [{ id: 'tool-after-progress' }])
      emitForwardedAgentStep(adapter, fixture, {
        messageId: 'message-after-progress',
        inputTokens: 0,
        outputTokens: 0
      })

      expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage).toEqual({
        totalTokens: 120,
        contextTokens: 120,
        toolUses: 1
      })
      expect(
        parts.filter((part) => part.type === 'data-agent-task-event' && part.data.event === 'progress').at(-1)
      ).toMatchObject({
        data: {
          taskId: fixture.agentId,
          usage: { totalTokens: 120, contextTokens: 120, toolUses: 1 }
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reads running and completed background Agent usage from its standard subagent transcript', () => {
    const fixture = createAgentTranscriptFixture('agent-background')
    try {
      const { adapter, statusEvents } = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      startAgentTask(adapter, fixture, { backgrounded: true })

      fixture.appendAssistantStep('message-background-1', 100, 20, [{ id: 'tool-background-1' }])
      fixture.appendAssistantStep('message-background-2', 200, 30, [
        { id: 'tool-background-2' },
        { id: 'tool-background-3' },
        { id: 'tool-background-4' }
      ])
      emitAgentProgress(adapter, fixture, { description: 'Checking the projection', durationMs: 2000 })
      expect(statusEvents.at(-1)?.data.usage).toEqual({
        totalTokens: 350,
        contextTokens: 230,
        toolUses: 4,
        durationMs: 2000
      })

      adapter.handleMessage(successResult({ session_id: fixture.sessionId }))
      completeBackgroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 3, durationMs: 3000 })
      expect(statusEvents.at(-1)?.data.usage).toEqual({
        totalTokens: 350,
        contextTokens: 240,
        toolUses: 3,
        durationMs: 3000
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reconciles the final background Agent step after its terminal notification races the transcript write', () => {
    vi.useFakeTimers()
    const fixture = createAgentTranscriptFixture('agent-background-terminal-race')
    let adapter: InstanceType<typeof ClaudeCodeStreamAdapter> | undefined
    try {
      const created = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      adapter = created.adapter
      const { statusEvents } = created
      startAgentTask(adapter, fixture, { backgrounded: true })

      fixture.appendAssistantStep('message-1', 100, 20, [{ id: 'tool-1' }])
      emitAgentProgress(adapter, fixture, { description: 'Reading the implementation', durationMs: 1000 })
      adapter.handleMessage(successResult({ session_id: fixture.sessionId }))
      completeBackgroundAgent(adapter, fixture, { contextTokens: 240, toolUses: 2, durationMs: 3000 })
      expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage).toEqual({
        totalTokens: 120,
        contextTokens: 240,
        toolUses: 2,
        durationMs: 3000
      })

      fixture.appendAssistantStep('message-2', 200, 30, [{ id: 'tool-2' }])
      adapter.handleMessage({
        type: 'system',
        subtype: 'session_state_changed',
        session_id: fixture.sessionId,
        uuid: crypto.randomUUID(),
        state: 'idle'
      } as any)
      vi.advanceTimersByTime(999)
      expect(getLastBackgroundTaskEvent(statusEvents)?.data.usage?.totalTokens).toBe(120)

      vi.advanceTimersByTime(1)
      expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
        event: 'notification',
        taskId: fixture.agentId,
        status: 'completed',
        isBackgrounded: true,
        usage: { totalTokens: 350, contextTokens: 240, toolUses: 2, durationMs: 3000 }
      })
    } finally {
      adapter?.dispose()
      fixture.cleanup()
      vi.useRealTimers()
    }
  })

  it('refreshes detached background Agent usage from its transcript on forwarded Agent messages', () => {
    const fixture = createAgentTranscriptFixture('agent-detached')
    try {
      const { adapter, statusEvents } = createAdapter({ claudeConfigDir: fixture.claudeConfigDir })
      startAgentTask(adapter, fixture, { backgrounded: true })
      adapter.handleMessage(successResult({ session_id: fixture.sessionId }))

      fixture.appendAssistantStep('message-detached', 200, 30, [{ id: 'tool-detached-1' }, { id: 'tool-detached-2' }])
      emitForwardedAgentStep(adapter, fixture, { messageId: 'message-detached', inputTokens: 0, outputTokens: 0 })

      expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
        taskId: fixture.agentId,
        status: 'in_progress',
        usage: { totalTokens: 230, contextTokens: 230, toolUses: 2 }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reconciles repeated task progress into one message part per lifecycle event', async () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      type: 'system',
      subtype: 'task_started',
      session_id: 'sdk-task',
      uuid: crypto.randomUUID(),
      task_id: 'task-1',
      description: 'Build launch deck'
    } as any)
    for (let index = 1; index <= 100; index += 1) {
      adapter.handleMessage({
        type: 'system',
        subtype: 'task_progress',
        session_id: 'sdk-task',
        uuid: crypto.randomUUID(),
        task_id: 'task-1',
        description: `Slide ${index}`,
        usage: { total_tokens: index, tool_uses: index, duration_ms: index * 1000 }
      } as any)
    }

    const stream = new ReadableStream<CherryUIMessageChunk>({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      }
    })
    let finalMessage: CherryUIMessage | undefined
    for await (const snapshot of readUIMessageStream<CherryUIMessage>({
      stream,
      message: { id: 'assistant-1', role: 'assistant', parts: [] }
    })) {
      finalMessage = snapshot
    }

    expect(finalMessage?.parts).toHaveLength(2)
    expect(finalMessage?.parts).toEqual([
      expect.objectContaining({
        type: 'data-agent-task-event',
        data: expect.objectContaining({ event: 'started', title: 'Build launch deck' })
      }),
      expect.objectContaining({
        type: 'data-agent-task-event',
        data: expect.objectContaining({
          event: 'progress',
          activeText: 'Slide 100',
          usage: { toolUses: 100, durationMs: 100_000 }
        })
      })
    ])
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
        id: 'task-task-9-updated',
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
        id: 'task-task-9-updated',
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
        id: 'task-task-1-notification',
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

  it('does not emit or persist tagged or synthetic-source reminders from the assistant stream', async () => {
    const { adapter, parts } = createAdapter()
    const reminder = 'The task tools have not been used recently.'

    adapter.handleMessage({
      type: 'user',
      isSynthetic: true,
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        role: 'user',
        content: [{ type: 'text', text: `<system-reminder>\n${reminder}\n</system-reminder>` }]
      }
    } as any)

    adapter.handleMessage(
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    )
    for (const text of [
      'before\n<system-',
      'reminder>Internal context.</system-rem',
      'inder>\nThe task tools have ',
      'not been used recently.\nafter'
    ]) {
      adapter.handleMessage(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
    }
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))

    const text = parts
      .filter((part): part is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => part.type === 'text-delta')
      .map((part) => part.delta)
      .join('')
    expect(text).toBe('before\n\n\nafter')

    const stream = new ReadableStream<CherryUIMessageChunk>({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      }
    })
    let finalMessage: CherryUIMessage | undefined
    for await (const snapshot of readUIMessageStream<CherryUIMessage>({
      stream,
      message: { id: 'assistant-1', role: 'assistant', parts: [] }
    })) {
      finalMessage = snapshot
    }
    const persistAssistant = vi.fn()
    const listener = new PersistenceListener({
      topicId: 'agent-session:session-1',
      backend: { kind: 'test', persistAssistant },
      onPersistFailed: vi.fn()
    })
    await listener.onDone({ status: 'success', isTopicDone: true, finalMessage })

    expect(persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        finalMessage: expect.objectContaining({ parts: [{ type: 'text', text: 'before\n\n\nafter', state: 'done' }] })
      })
    )
  })

  it('preserves ordinary assistant text that mentions system-reminder', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'The system-reminder name is documented here.' }
      })
    )

    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'text-delta', delta: 'The system-reminder name is documented here.' })
    )
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

  it('keeps nested Agent tools under the SDK parent while top-level Agent tools remain roots', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage({
      ...streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'nested-agent', name: 'Agent', input: {} }
      }),
      parent_tool_use_id: 'workflow-root'
    })
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'top-level-agent', name: 'Agent', input: {} }
      })
    )

    expect(parts[0]).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'nested-agent',
      providerMetadata: {
        'claude-code': {
          parentToolCallId: 'workflow-root'
        }
      }
    })
    expect(parts[1]).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'top-level-agent',
      providerMetadata: {
        'claude-code': {
          parentToolCallId: null
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

  it('survives a tool_use block that opens without a name and recovers it from the assistant message', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-1', input: {} }
      })
    )
    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"cmd":"pwd"}' }
      })
    )
    // Real Anthropic ordering: the content block closes before the aggregated assistant message.
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'sdk-1',
      uuid: crypto.randomUUID(),
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { cmd: 'pwd' } }]
      }
    } as any)

    expect(parts[0]).toMatchObject({ type: 'tool-input-start', toolCallId: 'tool-1', toolName: '' })
    expect(parts.filter((part) => part.type === 'tool-input-available')).toEqual([
      expect.objectContaining({ toolCallId: 'tool-1', toolName: 'Bash', input: { cmd: 'pwd' } })
    ])
  })

  it('falls back to a placeholder name when a nameless tool_use block is never completed', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-1', input: {} }
      })
    )
    adapter.handleMessage(streamEvent({ type: 'content_block_stop', index: 0 }))
    adapter.handleMessage(successResult())

    expect(parts.filter((part) => part.type === 'tool-input-available')).toEqual([
      expect.objectContaining({ toolCallId: 'tool-1', toolName: 'unknown-tool' })
    ])
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
        metadata: { type: 'mcp', name: 'web_search', serverName: 'cherry-tools', serverId: 'cherry-tools' }
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

  it.each([
    ['is_error', { is_error: true }],
    ['api_error terminal reason', { terminal_reason: 'api_error' }],
    ['API error status', { api_error_status: 504 }]
  ])('throws SDK success results marked by %s', (_, overrides) => {
    const { adapter, parts, sessionIds } = createAdapter()
    const resultText = 'API Error: The operation timed out.'
    let thrown: unknown

    try {
      adapter.handleMessage(successResult({ result: resultText, ...overrides }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ClaudeCodeResultError)
    expect(thrown).toMatchObject({
      message: resultText,
      subtype: 'success',
      errors: [resultText]
    })
    expect(sessionIds).toEqual(['sdk-result'])
    expect(parts.map((part) => part.type)).toEqual(['message-metadata'])
    expect(loggerMocks.info).not.toHaveBeenCalledWith(expect.stringContaining('Stream completed'))
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

  it('flushes a trailing reminder-marker prefix before throwing on error results', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'comparison <' }
      })
    )

    expect(() =>
      adapter.handleMessage(
        successResult({
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['boom']
        })
      )
    ).toThrow('boom')

    expect(
      parts
        .filter((part): part is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('')
    ).toBe('comparison <')
    expect(parts.findIndex((part) => part.type === 'text-end')).toBeLessThan(
      parts.findIndex((part) => part.type === 'message-metadata')
    )
  })

  it('flushes a trailing reminder-marker prefix when open text parts are finalized', () => {
    const { adapter, parts } = createAdapter()

    adapter.handleMessage(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'comparison <' }
      })
    )
    adapter.finalizeOpenTextParts()

    expect(
      parts
        .filter((part): part is Extract<CherryUIMessageChunk, { type: 'text-delta' }> => part.type === 'text-delta')
        .map((part) => part.delta)
        .join('')
    ).toBe('comparison <')
    expect(parts.at(-1)?.type).toBe('text-end')
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

    it('throws an API failure result when no turn is active', () => {
      const { adapter, parts, sessionIds } = createAdapter({}, { openTurn: false })
      let thrown: unknown

      try {
        adapter.handleMessage(
          successResult({
            session_id: 'resume-api-error',
            is_error: true,
            terminal_reason: 'api_error',
            api_error_status: 504,
            result: 'API Error: The operation timed out.'
          })
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ClaudeCodeResultError)
      expect(thrown).toMatchObject({
        message: 'API Error: The operation timed out.',
        subtype: 'success',
        terminalReason: 'api_error',
        apiErrorStatus: 504
      })
      expect(sessionIds).toEqual(['resume-api-error'])
      expect(parts).toEqual([])
      expect(loggerMocks.warn).not.toHaveBeenCalledWith(
        'Received a result message with no active turn; dropping turn-complete',
        expect.anything()
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

    it('enriches a local workflow task from its launch receipt without handling remote agents', () => {
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
              id: 'workflow-tool-use',
              name: 'Workflow',
              input: { name: 'review-pr' }
            }
          ]
        }
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'workflow-1', task_type: 'local_workflow', description: 'review-pr' }]
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
              tool_use_id: 'workflow-tool-use',
              content: JSON.stringify({
                status: 'async_launched',
                taskId: 'workflow-1',
                taskType: 'local_workflow',
                workflowName: 'review-pr'
              }),
              is_error: false
            }
          ]
        }
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks').at(-1)).toEqual({
        type: 'background-tasks',
        tasks: [
          {
            id: 'workflow-1',
            type: 'local_workflow',
            description: 'review-pr',
            toolCallId: 'workflow-tool-use'
          }
        ]
      })
    })

    it('uses the structured Bash result only to correlate a background command with its exact tool call', () => {
      const { adapter, parts, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'bash-tool-use',
              name: 'Bash',
              input: { command: 'pnpm dev', description: 'Start the development server', run_in_background: true }
            }
          ]
        }
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'bash-1', task_type: 'local_bash', description: 'Start the development server' }]
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
              tool_use_id: 'bash-tool-use',
              content: 'Command running in background.',
              is_error: false
            }
          ]
        },
        tool_use_result: {
          stdout: 'ready on http://localhost:5173',
          stderr: '',
          interrupted: false,
          backgroundTaskId: 'bash-1'
        }
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks').at(-1)).toEqual({
        type: 'background-tasks',
        tasks: [
          {
            id: 'bash-1',
            type: 'local_bash',
            description: 'Start the development server',
            toolCallId: 'bash-tool-use'
          }
        ]
      })
      expect(parts).toContainEqual(
        expect.objectContaining({
          type: 'tool-output-available',
          toolCallId: 'bash-tool-use',
          output: 'Command running in background.'
        })
      )
    })

    it('does not correlate a Bash command from a generic async launch receipt', () => {
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
              id: 'bash-tool-use',
              name: 'Bash',
              input: { command: 'pnpm dev', run_in_background: true }
            }
          ]
        }
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'bash-1', task_type: 'local_bash', description: 'pnpm dev' }]
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
              tool_use_id: 'bash-tool-use',
              content: 'Command running in background.',
              is_error: false
            }
          ]
        },
        tool_use_result: {
          status: 'async_launched',
          taskId: 'bash-1'
        }
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks').at(-1)).toEqual({
        type: 'background-tasks',
        tasks: [{ id: 'bash-1', type: 'local_bash', description: 'pnpm dev' }]
      })
    })

    it('marks polled background Bash output as preliminary and only emits replacements when the content changes', () => {
      vi.useFakeTimers()
      const fixture = createBackgroundBashFixture()
      try {
        fixture.writeOutput('server starting\n')
        const { adapter, parts, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture)

        expect(parts).toContainEqual({
          type: 'tool-output-available',
          toolCallId: 'bash-tool-use',
          output: 'server starting\n',
          dynamic: true,
          providerExecuted: true,
          preliminary: true
        })
        adapter.handleMessage(successResult())
        statusEvents.length = 0

        fixture.appendOutput('ready on http://localhost:5173\n')
        vi.advanceTimersByTime(1000)
        expect(statusEvents.filter((event) => event.type === 'background-flow-chunk')).toEqual([
          {
            type: 'background-flow-chunk',
            rootToolCallId: 'bash-tool-use',
            chunk: {
              type: 'tool-output-available',
              toolCallId: 'bash-tool-use',
              output: 'server starting\nready on http://localhost:5173\n',
              dynamic: true,
              providerExecuted: true,
              preliminary: true
            }
          }
        ])

        vi.advanceTimersByTime(1000)
        expect(statusEvents.filter((event) => event.type === 'background-flow-chunk')).toHaveLength(1)
        adapter.dispose()
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('uses the final provider receipt when earlier output contains receipt-like text', () => {
      const fixture = createBackgroundBashFixture()
      try {
        fixture.writeOutput('final receipt selected\n')
        const misleadingReceipt = fixture.receipt(
          'different-task',
          path.join(path.dirname(fixture.outputFile), 'different-task.output')
        )
        const { adapter, parts } = createAdapter()

        launchBackgroundBash(adapter, fixture, {
          toolResultContent: `${misleadingReceipt}\ncommand output\n${fixture.receipt()}`
        })

        expect(parts).toContainEqual({
          type: 'tool-output-available',
          toolCallId: 'bash-tool-use',
          output: 'final receipt selected\n',
          dynamic: true,
          providerExecuted: true,
          preliminary: true
        })
        adapter.dispose()
      } finally {
        fixture.cleanup()
      }
    })

    it('replaces a completed background Bash result with the final output file contents', () => {
      const fixture = createBackgroundBashFixture()
      try {
        fixture.writeOutput('ready on http://localhost:5173\ncompiled successfully\n')
        const { adapter, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture)
        adapter.handleMessage(successResult())
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'bash-1',
          status: 'completed',
          output_file: fixture.outputFile,
          summary: 'Development server exited'
        } as any)

        expect(statusEvents.filter((event) => event.type === 'background-flow-chunk').at(-1)).toEqual({
          type: 'background-flow-chunk',
          rootToolCallId: 'bash-tool-use',
          chunk: {
            type: 'tool-output-available',
            toolCallId: 'bash-tool-use',
            output: 'ready on http://localhost:5173\ncompiled successfully\n',
            dynamic: true,
            providerExecuted: true
          }
        })
        adapter.dispose()
      } finally {
        fixture.cleanup()
      }
    })

    it('bounds oversized background Bash output with an explicit head-tail truncation marker', () => {
      const fixture = createBackgroundBashFixture('bash-large')
      const fullOutput = `HEAD: server starting\n${'x'.repeat(96 * 1024)}\nTAIL: server stopped\n`
      try {
        MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
        fixture.writeOutput(fullOutput)
        const { adapter, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture, { toolCallId: 'bash-large-tool-use' })
        adapter.handleMessage(successResult())

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'bash-large',
          status: 'completed',
          output_file: fixture.outputFile,
          summary: 'Verbose server stopped'
        } as any)

        const event = statusEvents.findLast((item) => item.type === 'background-flow-chunk')
        expect(event?.chunk).toMatchObject({
          type: 'tool-output-available',
          toolCallId: 'bash-large-tool-use'
        })
        const output = event?.chunk.output as string
        expect(output).toContain('HEAD: server starting')
        expect(output).toContain('TAIL: server stopped')
        const omittedBytes = Buffer.byteLength(fullOutput) - 64 * 1024
        expect(output).toContain(`[输出已截断：已省略 ${omittedBytes} 字节]`)
        expect(Buffer.byteLength(output, 'utf8')).toBeLessThan(70 * 1024)
        expect(output).not.toBe(fullOutput)
        expect(loggerMocks.warn).toHaveBeenCalledWith(
          'Truncated background Bash output',
          expect.objectContaining({
            taskId: 'bash-large',
            outputFile: fixture.outputFile,
            sizeBytes: Buffer.byteLength(fullOutput)
          })
        )
        adapter.dispose()
      } finally {
        fixture.cleanup()
      }
    })

    it.each([
      { status: 'failed', summary: 'Development server crashed' },
      { status: 'stopped', summary: 'Development server was stopped' }
    ])('maps a $status background Bash notification to a tool error terminal', ({ status, summary }) => {
      const fixture = createBackgroundBashFixture(`bash-${status}`)
      try {
        fixture.writeOutput('last command output\n')
        const { adapter, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture, { toolCallId: `bash-${status}-tool-use` })
        adapter.handleMessage(successResult())

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: `bash-${status}`,
          status,
          output_file: fixture.outputFile,
          summary
        } as any)

        const event = statusEvents.findLast((item) => item.type === 'background-flow-chunk')
        expect(event?.chunk).toEqual({
          type: 'tool-output-error',
          toolCallId: `bash-${status}-tool-use`,
          errorText: `${summary}\n\nlast command output\n`,
          dynamic: true,
          providerExecuted: true
        })
        expect(statusEvents).not.toContainEqual(
          expect.objectContaining({
            type: 'background-flow-chunk',
            chunk: expect.objectContaining({ type: 'tool-output-available', toolCallId: `bash-${status}-tool-use` })
          })
        )
        adapter.dispose()
      } finally {
        fixture.cleanup()
      }
    })

    it('rejects background Bash receipts that do not match the authoritative task path', () => {
      vi.useFakeTimers()
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'claude-prefix-collision-'))
      const fixture = createBackgroundBashFixture()
      try {
        const createFile = (filePath: string) => {
          mkdirSync(path.dirname(filePath), { recursive: true })
          writeFileSync(filePath, 'must not be published\n')
          return filePath
        }
        const mismatchedTaskFile = createFile(path.join(path.dirname(fixture.outputFile), 'bash-other.output'))
        const invalidCases = [
          {
            label: 'receipt task id mismatch',
            receiptTaskId: 'bash-other',
            outputFile: mismatchedTaskFile
          },
          {
            label: 'relative path',
            receiptTaskId: fixture.taskId,
            outputFile: path.join('relative', fixture.sessionId, 'tasks', `${fixture.taskId}.output`)
          },
          {
            label: 'wrong basename',
            receiptTaskId: fixture.taskId,
            outputFile: createFile(path.join(path.dirname(fixture.outputFile), 'different.output'))
          },
          {
            label: 'wrong parent directory',
            receiptTaskId: fixture.taskId,
            outputFile: createFile(path.join(fixture.cwdDir, fixture.sessionId, 'output', `${fixture.taskId}.output`))
          },
          {
            label: 'wrong SDK session directory',
            receiptTaskId: fixture.taskId,
            outputFile: createFile(path.join(fixture.cwdDir, 'sdk-other', 'tasks', `${fixture.taskId}.output`))
          },
          {
            label: 'Claude root prefix collision',
            receiptTaskId: fixture.taskId,
            outputFile: createFile(path.join(outsideDir, fixture.sessionId, 'tasks', `${fixture.taskId}.output`))
          }
        ]

        for (const invalidCase of invalidCases) {
          const { adapter, parts, statusEvents } = createAdapter()
          launchBackgroundBash(adapter, fixture, {
            toolCallId: `bash-tool-${invalidCase.label}`,
            receiptTaskId: invalidCase.receiptTaskId,
            receiptOutputFile: invalidCase.outputFile
          })
          adapter.handleMessage(successResult())
          vi.advanceTimersByTime(2000)

          const backgroundReplacements = statusEvents.filter(
            (event) => event.type === 'background-flow-chunk' && event.chunk.type === 'tool-output-available'
          )
          expect(backgroundReplacements, invalidCase.label).toEqual([])
          expect(parts).toContainEqual(
            expect.objectContaining({
              type: 'tool-output-available',
              toolCallId: `bash-tool-${invalidCase.label}`
            })
          )
          adapter.dispose()
        }
        expect(loggerMocks.warn).toHaveBeenCalledWith(
          'Rejected background Bash output receipt',
          expect.objectContaining({ sessionId: 'session-1' })
        )
      } finally {
        fixture.cleanup()
        rmSync(outsideDir, { recursive: true, force: true })
        vi.useRealTimers()
      }
    })

    it('uses a validated terminal output file when the launch receipt path was invalid', () => {
      const fixture = createBackgroundBashFixture('bash-terminal-path')
      try {
        fixture.writeOutput('terminal output recovered\n')
        const { adapter, parts, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture, {
          receiptOutputFile: path.join('relative', fixture.sessionId, 'tasks', `${fixture.taskId}.output`)
        })
        adapter.handleMessage(successResult())

        expect(parts).toContainEqual(
          expect.objectContaining({
            type: 'tool-output-available',
            toolCallId: 'bash-tool-use'
          })
        )
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: fixture.sessionId,
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          status: 'completed',
          output_file: fixture.outputFile,
          summary: 'Command completed'
        } as any)

        expect(statusEvents).toContainEqual({
          type: 'background-flow-chunk',
          rootToolCallId: 'bash-tool-use',
          chunk: {
            type: 'tool-output-available',
            toolCallId: 'bash-tool-use',
            output: 'terminal output recovered\n',
            dynamic: true,
            providerExecuted: true
          }
        })
        adapter.dispose()
      } finally {
        fixture.cleanup()
      }
    })

    it('publishes the final Bash output once on terminal task updates and stops polling', () => {
      vi.useFakeTimers()
      const fixture = createBackgroundBashFixture()
      try {
        fixture.writeOutput('initial output\n')
        const { adapter, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture)
        adapter.handleMessage(successResult())
        statusEvents.length = 0

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_updated',
          session_id: fixture.sessionId,
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          patch: { status: 'completed' }
        } as any)
        fixture.appendOutput('late output\n')
        vi.advanceTimersByTime(2000)

        // The terminal update publishes the final output once and stops polling.
        const chunks = statusEvents.filter((event) => event.type === 'background-flow-chunk')
        expect(chunks).toHaveLength(1)
        expect(chunks[0].chunk).toMatchObject({ output: 'initial output\n', toolCallId: 'bash-tool-use' })
        adapter.dispose()
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('clears a background Bash poller when terminal task state is released', () => {
      vi.useFakeTimers()
      try {
        const { adapter } = createAdapter()
        const poll = vi.fn()
        const timer = setInterval(poll, 1000)
        ;(adapter as any).backgroundBashOutputs.set('bash-release', {
          toolCallId: 'bash-tool-use',
          outputFile: 'unused',
          timer
        })

        ;(adapter as any).releaseTerminalTaskState('bash-release')
        vi.advanceTimersByTime(2000)

        expect(poll).not.toHaveBeenCalled()
        expect((adapter as any).backgroundBashOutputs.has('bash-release')).toBe(false)
        adapter.dispose()
      } finally {
        vi.useRealTimers()
      }
    })

    it('matches only the known local Bash task type', () => {
      const { adapter } = createAdapter()
      const taskTypes = (adapter as any).backgroundTaskTypes as Map<string, string>
      taskTypes.set('bash-task', 'local_bash')
      taskTypes.set('extension-task', 'shell_extension')

      expect((adapter as any).isBackgroundBashTask('bash-task')).toBe(true)
      expect((adapter as any).isBackgroundBashTask('extension-task')).toBe(false)
      adapter.dispose()
    })

    it('stops background Bash polling and clears task associations at quiescent idle', () => {
      vi.useFakeTimers()
      const fixture = createBackgroundBashFixture()
      try {
        fixture.writeOutput('initial output\n')
        const { adapter, statusEvents } = createAdapter()
        launchBackgroundBash(adapter, fixture)
        adapter.handleMessage(successResult())
        adapter.handleMessage({
          type: 'system',
          subtype: 'background_tasks_changed',
          session_id: fixture.sessionId,
          uuid: crypto.randomUUID(),
          tasks: []
        } as any)
        adapter.handleMessage({
          type: 'system',
          subtype: 'session_state_changed',
          session_id: fixture.sessionId,
          uuid: crypto.randomUUID(),
          state: 'idle'
        } as any)
        statusEvents.length = 0

        fixture.appendOutput('late output\n')
        vi.advanceTimersByTime(2000)
        adapter.handleMessage({
          type: 'system',
          subtype: 'background_tasks_changed',
          session_id: fixture.sessionId,
          uuid: crypto.randomUUID(),
          tasks: [{ task_id: fixture.taskId, task_type: 'local_bash', description: 'Reused task id' }]
        } as any)

        expect(statusEvents).toEqual([
          {
            type: 'background-tasks',
            tasks: [{ id: fixture.taskId, type: 'local_bash', description: 'Reused task id' }]
          },
          { type: 'background-work-state', active: true }
        ])
        adapter.dispose()
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it.each([
      {
        label: 'ordinary provider',
        toolUse: { type: 'tool_use', id: 'not-workflow-tool', name: 'Read', input: { file_path: 'README.md' } },
        result: {
          type: 'tool_result',
          tool_use_id: 'not-workflow-tool',
          content: 'Read complete',
          is_error: false
        }
      },
      {
        label: 'MCP',
        toolUse: {
          type: 'mcp_tool_use',
          id: 'not-workflow-tool',
          name: 'Workflow',
          server_name: 'fake-workflows',
          input: { name: 'review-pr' }
        },
        result: {
          type: 'mcp_tool_result',
          tool_use_id: 'not-workflow-tool',
          content: [{ type: 'text', text: 'MCP call complete' }],
          is_error: false
        }
      }
    ])('does not treat a $label structured result as a local Workflow launch', ({ toolUse, result }) => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot()
        const { adapter, statusEvents } = createAdapter()
        adapter.handleMessage({
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          message: { content: [toolUse] }
        } as any)
        adapter.handleMessage({
          type: 'system',
          subtype: 'background_tasks_changed',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          tasks: [{ task_id: fixture.taskId, task_type: 'local_workflow', description: 'Review the pull request' }]
        } as any)
        adapter.handleMessage({
          type: 'user',
          parent_tool_use_id: null,
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          message: { content: [result] },
          tool_use_result: {
            status: 'async_launched',
            taskId: fixture.taskId,
            taskType: 'local_workflow',
            workflowName: 'review-pr',
            runId: fixture.runId,
            transcriptDir: fixture.transcriptDir
          }
        } as any)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          description: 'Review progress',
          usage: { total_tokens: 120, tool_uses: 3, duration_ms: 1000 }
        } as any)

        expect(statusEvents.filter((event) => event.type === 'background-tasks').at(-1)).toEqual({
          type: 'background-tasks',
          tasks: [
            {
              id: fixture.taskId,
              type: 'local_workflow',
              description: 'Review the pull request'
            }
          ]
        })
        expect(statusEvents.at(-1)).toMatchObject({
          type: 'background-task-event',
          data: { taskId: fixture.taskId }
        })
        expect(statusEvents.at(-1)?.data.workflow).toBeUndefined()
      } finally {
        fixture.cleanup()
      }
    })

    it('keeps task creation and completion timestamps stable across lifecycle updates', () => {
      vi.useFakeTimers()
      vi.setSystemTime('2026-08-12T08:00:00.000Z')
      try {
        const { adapter, statusEvents } = createAdapter()

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'task-1',
          description: 'Review the pull request'
        } as any)
        vi.advanceTimersByTime(1000)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'task-1',
          description: 'Reading files',
          usage: { total_tokens: 100, tool_uses: 2, duration_ms: 1000 }
        } as any)
        vi.advanceTimersByTime(1000)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'task-1',
          status: 'completed',
          output_file: '/tmp/task-1.output',
          summary: 'Review complete'
        } as any)
        vi.advanceTimersByTime(1000)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: 'task-1',
          status: 'completed',
          output_file: '/tmp/task-1.output',
          summary: 'Review complete'
        } as any)

        const taskEvents = statusEvents.filter((event) => event.type === 'background-task-event')
        expect(taskEvents.map((event) => event.data.createdAt)).toEqual([
          '2026-08-12T08:00:00.000Z',
          '2026-08-12T08:00:00.000Z',
          '2026-08-12T08:00:00.000Z',
          '2026-08-12T08:00:00.000Z'
        ])
        expect(taskEvents.map((event) => event.data.completedAt)).toEqual([
          undefined,
          undefined,
          '2026-08-12T08:00:02.000Z',
          '2026-08-12T08:00:02.000Z'
        ])
      } finally {
        vi.useRealTimers()
      }
    })

    it('attaches validated workflow snapshots live without persisting one for every progress event', () => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot({ phases: undefined })
        const { adapter, parts, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Review the pull request',
          task_type: 'local_workflow',
          workflow_name: 'review-pr'
        } as any)
        for (let index = 0; index < 3; index += 1) {
          adapter.handleMessage({
            type: 'system',
            subtype: 'task_progress',
            session_id: 'sdk-1',
            uuid: crypto.randomUUID(),
            task_id: fixture.taskId,
            tool_use_id: 'workflow-tool-use',
            description: `Review progress ${index + 1}`,
            usage: { total_tokens: 120 + index, tool_uses: 3, duration_ms: 1000 + index }
          } as any)
        }
        fixture.writeSnapshot({
          phases: [{ title: 'Review' }],
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'review:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 200,
              toolCalls: 4,
              durationMs: 2000
            }
          ],
          totalTokens: 200,
          totalToolCalls: 4
        })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete',
          usage: { total_tokens: 200, tool_uses: 4, duration_ms: 2000 }
        } as any)

        const liveTaskEvents = statusEvents.filter((event) => event.type === 'background-task-event')
        expect(liveTaskEvents).toHaveLength(5)
        expect(liveTaskEvents.every((event) => event.data.workflow?.runId === fixture.runId)).toBe(true)
        expect(liveTaskEvents[0].data).toMatchObject({
          createdAt: '2026-08-12T08:00:00.000Z',
          workflow: {
            runId: fixture.runId,
            taskId: fixture.taskId,
            phases: [],
            workflowProgress: [
              { type: 'workflow_phase', index: 1, title: 'Review' },
              expect.objectContaining({ type: 'workflow_agent', label: 'review:main', state: 'running' })
            ]
          }
        })
        expect(liveTaskEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 200,
          totalToolCalls: 4,
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            expect.objectContaining({ type: 'workflow_agent', state: 'done', tokens: 200, toolCalls: 4 })
          ]
        })

        const persistedTaskEvents = parts.filter((part) => part.type === 'data-agent-task-event')
        const persistedWorkflowEvents = persistedTaskEvents.filter((part) => part.data.workflow)
        expect(persistedWorkflowEvents).toHaveLength(2)
        expect(persistedWorkflowEvents[0].data.workflow?.runId).toBe(fixture.runId)
        expect(persistedTaskEvents.at(-1)?.data.status).toBe('completed')
      } finally {
        fixture.cleanup()
      }
    })

    it('builds the running workflow layout and per-agent stats before the terminal snapshot file exists', () => {
      vi.useFakeTimers()
      vi.setSystemTime('2026-08-12T08:00:00.000Z')
      const fixture = createWorkflowFixture()
      try {
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
                id: 'workflow-tool-use',
                name: 'Workflow',
                input: { script: fixture.script }
              }
            ]
          }
        } as any)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Review a pull request',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)
        adapter.handleMessage({
          type: 'user',
          parent_tool_use_id: null,
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          timestamp: '2026-08-12T08:00:00.000Z',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'workflow-tool-use',
                content: 'Workflow launched in background',
                is_error: false
              }
            ]
          },
          tool_use_result: {
            status: 'async_launched',
            taskId: fixture.taskId,
            taskType: 'local_workflow',
            workflowName: 'review-pr',
            runId: fixture.runId,
            transcriptDir: fixture.transcriptDir
          }
        } as any)

        vi.setSystemTime('2026-08-12T08:00:04.000Z')
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Verify: verifier:main',
          last_tool_name: 'verifier:main',
          usage: { total_tokens: 0, tool_uses: 5, duration_ms: 6500 },
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            { type: 'workflow_phase', index: 2, title: 'Verify' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 120,
              toolCalls: 1,
              durationMs: 2000
            },
            {
              type: 'workflow_agent',
              index: 2,
              label: 'verifier:main',
              phaseIndex: 2,
              phaseTitle: 'Verify',
              state: 'progress',
              startedAt: 10_000,
              lastProgressAt: 14_000,
              tokens: 240,
              toolCalls: 4
            }
          ]
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toEqual({
          runId: fixture.runId,
          taskId: fixture.taskId,
          workflowName: 'review-pr',
          totalTokens: 360,
          totalToolCalls: 5,
          durationMs: 6500,
          phases: [{ title: 'Review' }, { title: 'Verify' }],
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            { type: 'workflow_phase', index: 2, title: 'Verify' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 120,
              toolCalls: 1,
              durationMs: 2000
            },
            {
              type: 'workflow_agent',
              index: 2,
              label: 'verifier:main',
              phaseIndex: 2,
              phaseTitle: 'Verify',
              state: 'running',
              startedAt: 10_000,
              tokens: 240,
              toolCalls: 4,
              durationMs: 4000
            }
          ]
        })

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Review: reviewer:main',
          last_tool_name: 'reviewer:main',
          usage: { total_tokens: 400, tool_uses: 6, duration_ms: 7000 }
        } as any)
        const throttledWorkflow = statusEvents.at(-1)?.data.workflow
        expect(throttledWorkflow).toMatchObject({
          totalTokens: 360,
          totalToolCalls: 5,
          durationMs: 7000
        })
        expect(throttledWorkflow?.workflowProgress.filter((progress) => progress.type === 'workflow_agent')).toEqual([
          expect.objectContaining({
            label: 'reviewer:main',
            state: 'done',
            tokens: 120,
            toolCalls: 1,
            durationMs: 2000
          }),
          expect.objectContaining({
            label: 'verifier:main',
            state: 'running',
            tokens: 240,
            toolCalls: 4,
            durationMs: 4000
          })
        ])

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Verify: verifier:main',
          last_tool_name: 'verifier:main',
          usage: { total_tokens: 420, tool_uses: 7, duration_ms: 7200 },
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            { type: 'workflow_phase', index: 2, title: 'Verify' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 120,
              toolCalls: 1,
              durationMs: 2000
            },
            {
              type: 'workflow_agent',
              index: 2,
              label: 'verifier:main',
              phaseIndex: 2,
              phaseTitle: 'Verify',
              state: 'progress'
            }
          ]
        } as any)
        expect(statusEvents.at(-1)?.data.workflow?.workflowProgress).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              label: 'verifier:main',
              state: 'running',
              tokens: 240,
              toolCalls: 4,
              durationMs: 4000
            })
          ])
        )

        fixture.writeSnapshot({
          durationMs: 7500,
          phases: [{ title: 'Review' }, { title: 'Verify' }],
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            { type: 'workflow_phase', index: 2, title: 'Verify' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 150,
              cumulativeTokens: 350,
              toolCalls: 2,
              durationMs: 2500
            },
            {
              type: 'workflow_agent',
              index: 2,
              label: 'verifier:main',
              phaseIndex: 2,
              phaseTitle: 'Verify',
              state: 'done',
              tokens: 300,
              cumulativeTokens: 550,
              toolCalls: 6,
              durationMs: 5000
            }
          ],
          totalTokens: 450,
          totalCumulativeTokens: 900,
          totalToolCalls: 8
        })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete',
          usage: { total_tokens: 500, tool_uses: 8, duration_ms: 7600 }
        } as any)
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 500,
          totalCumulativeTokens: 900,
          totalToolCalls: 8,
          durationMs: 7500,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({
              label: 'reviewer:main',
              tokens: 150,
              cumulativeTokens: 350,
              toolCalls: 2,
              durationMs: 2500
            }),
            expect.objectContaining({
              label: 'verifier:main',
              tokens: 300,
              cumulativeTokens: 550,
              toolCalls: 6,
              durationMs: 5000
            })
          ])
        })
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('uses SDK workflow_progress without synchronously reading a non-terminal snapshot', () => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot({ padding: 'x'.repeat(1_048_576) })
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)
        loggerMocks.warn.mockClear()

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'progress',
              tokens: 120,
              toolCalls: 2
            }
          ]
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 120,
          totalToolCalls: 2,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({ label: 'reviewer:main', state: 'running', tokens: 120, toolCalls: 2 })
          ])
        })
        expect(loggerMocks.warn).not.toHaveBeenCalledWith('Skipped oversized workflow snapshot', expect.anything())
      } finally {
        fixture.cleanup()
      }
    })

    it('accumulates running workflow Agent transcript stats from new steps', () => {
      const fixture = createWorkflowFixture()
      const agentId = 'agent-live'
      const transcriptPath = path.join(fixture.transcriptDir, `agent-${agentId}.jsonl`)
      const writeAssistantStep = (
        messageId: string,
        inputTokens: number,
        outputTokens: number,
        toolUses: Array<{ id: string; type: 'tool_use' | 'server_tool_use' | 'mcp_tool_use' }> = []
      ) => {
        appendFileSync(
          transcriptPath,
          `${JSON.stringify({
            type: 'assistant',
            uuid: crypto.randomUUID(),
            message: {
              id: messageId,
              usage: {
                input_tokens: inputTokens,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: outputTokens
              },
              content: toolUses.map(({ id, type }) => ({ type, id, name: 'Read', input: {} }))
            }
          })}\n`
        )
      }

      try {
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)

        writeAssistantStep('message-1', 0, 0, [{ id: 'tool-1', type: 'tool_use' }])
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              agentId,
              state: 'progress',
              tokens: 0,
              toolCalls: 0
            }
          ]
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalToolCalls: 1,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({ label: 'reviewer:main', tokens: 0, toolCalls: 1 })
          ])
        })

        writeAssistantStep('message-1', 24_000, 321, [{ id: 'tool-1', type: 'tool_use' }])
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use'
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 24_321,
          totalCumulativeTokens: 24_321,
          totalToolCalls: 1,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({
              label: 'reviewer:main',
              tokens: 24_321,
              cumulativeTokens: 24_321,
              toolCalls: 1
            })
          ])
        })

        fixture.writeSnapshot({
          totalTokens: 1,
          totalToolCalls: 0,
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'running',
              tokens: 1,
              toolCalls: 0
            }
          ]
        })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use'
        } as any)

        writeAssistantStep('message-2', 12_000, 123, [
          { id: 'tool-2', type: 'mcp_tool_use' },
          { id: 'tool-3', type: 'server_tool_use' }
        ])
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          usage: { total_tokens: 12_123, tool_uses: 2, duration_ms: 2000 }
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 12_123,
          totalCumulativeTokens: 36_444,
          totalToolCalls: 3,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({
              label: 'reviewer:main',
              tokens: 12_123,
              cumulativeTokens: 36_444,
              toolCalls: 3
            })
          ])
        })

        writeAssistantStep('message-2', 1, 1, [{ id: 'tool-2', type: 'mcp_tool_use' }])
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use'
        } as any)
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 12_123,
          totalCumulativeTokens: 36_444,
          totalToolCalls: 3
        })

        writeFileSync(
          transcriptPath,
          `${JSON.stringify({
            type: 'assistant',
            uuid: crypto.randomUUID(),
            message: {
              id: 'message-3',
              usage: {
                input_tokens: 1_000,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 7
              },
              content: [{ type: 'tool_use', id: 'tool-4', name: 'Read', input: {} }]
            }
          })}\n`
        )
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use'
        } as any)
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 1007,
          totalCumulativeTokens: 37_451,
          totalToolCalls: 4
        })

        fixture.writeSnapshot({
          totalTokens: 12_123,
          totalToolCalls: 3,
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 12_123,
              toolCalls: 3
            }
          ]
        })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete'
        } as any)
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 12_123,
          totalCumulativeTokens: 37_451,
          totalToolCalls: 3,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({
              label: 'reviewer:main',
              tokens: 12_123,
              cumulativeTokens: 37_451,
              toolCalls: 4
            })
          ])
        })
      } finally {
        fixture.cleanup()
      }
    })

    it('reconciles the final workflow Agent step after the terminal notification races its transcript write', () => {
      vi.useFakeTimers()
      const fixture = createWorkflowFixture()
      const agentId = 'agent-terminal-race'
      const transcriptPath = path.join(fixture.transcriptDir, `agent-${agentId}.jsonl`)

      try {
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage(successResult({ session_id: 'sdk-1' }))
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)

        appendAssistantTranscriptStep(transcriptPath, 'message-1', 100, 20)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              agentId,
              state: 'progress',
              tokens: 120,
              cumulativeTokens: 120,
              toolCalls: 0
            }
          ]
        } as any)

        fixture.writeSnapshot({
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              agentId,
              state: 'done',
              tokens: 120,
              cumulativeTokens: 120,
              toolCalls: 0
            }
          ],
          totalTokens: 120,
          totalCumulativeTokens: 120,
          totalToolCalls: 0
        })
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
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete'
        } as any)

        expect(getLastBackgroundTaskEvent(statusEvents)?.data.workflow).toMatchObject({ totalCumulativeTokens: 120 })

        appendAssistantTranscriptStep(transcriptPath, 'message-2', 200, 30)
        adapter.handleMessage({
          type: 'system',
          subtype: 'session_state_changed',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          state: 'idle'
        } as any)
        expect(statusEvents).not.toContainEqual({ type: 'background-work-state', active: false })
        vi.advanceTimersByTime(999)

        expect(getLastBackgroundTaskEvent(statusEvents)?.data.workflow).toMatchObject({ totalCumulativeTokens: 120 })

        vi.advanceTimersByTime(1)

        expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
          event: 'notification',
          status: 'completed',
          workflow: {
            totalTokens: 120,
            totalCumulativeTokens: 350,
            totalToolCalls: 0,
            workflowProgress: expect.arrayContaining([
              expect.objectContaining({
                label: 'reviewer:main',
                tokens: 120,
                cumulativeTokens: 350,
                toolCalls: 0
              })
            ])
          }
        })
        expect(statusEvents.at(-1)).toEqual({ type: 'background-work-state', active: false })
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('retries the terminal workflow reconciliation while the snapshot lags the terminal context size', () => {
      vi.useFakeTimers()
      const fixture = createWorkflowFixture()
      try {
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage(successResult({ session_id: 'sdk-1' }))
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)

        // The snapshot lags the terminal event: the file only carries the stale total.
        fixture.writeSnapshot({ totalTokens: 120, totalCumulativeTokens: 120, totalToolCalls: 0 })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete',
          usage: { total_tokens: 500, tool_uses: 2, duration_ms: 1000 }
        } as any)

        // The terminal event reports the final context size (500) the snapshot has not caught up to.
        expect(getLastBackgroundTaskEvent(statusEvents)?.data.workflow).toMatchObject({
          totalTokens: 500,
          totalCumulativeTokens: 120
        })

        // First reconcile attempt: snapshot still stale — keep waiting, no final event yet.
        vi.advanceTimersByTime(1000)
        expect(getLastBackgroundTaskEvent(statusEvents)?.data.workflow).toMatchObject({
          totalTokens: 500,
          totalCumulativeTokens: 120
        })
        expect((adapter as any).pendingTerminalWorkflowEvents.size).toBe(1)

        // The CLI finishes writing the snapshot; the retry matches and settles the statistics.
        fixture.writeSnapshot({ totalTokens: 500, totalCumulativeTokens: 500, totalToolCalls: 2 })
        // Force an mtime bump so the adapter re-reads the file even though the byte size is identical.
        const bumpedMtime = new Date(Date.now() + 60_000)
        utimesSync(fixture.snapshotPath, bumpedMtime, bumpedMtime)
        vi.advanceTimersByTime(1000)

        expect(getLastBackgroundTaskEvent(statusEvents)?.data.workflow).toMatchObject({
          totalTokens: 500,
          totalCumulativeTokens: 500
        })
        expect((adapter as any).pendingTerminalWorkflowEvents.size).toBe(0)
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('gives up the terminal workflow reconciliation after the bounded retry budget', () => {
      vi.useFakeTimers()
      const fixture = createWorkflowFixture()
      try {
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage(successResult({ session_id: 'sdk-1' }))
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)

        // An oversized snapshot is never readable: every attempt yields no stats.
        fixture.writeSnapshot({ totalTokens: 500, totalCumulativeTokens: 500, totalToolCalls: 2 })
        writeFileSync(fixture.snapshotPath, `{${'x'.repeat(1_100_000)}}`)

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete',
          usage: { total_tokens: 500, tool_uses: 2, duration_ms: 1000 }
        } as any)

        const eventsBeforeRetries = statusEvents.length
        // The retry budget is bounded: two retries remain live, then the third attempt releases it.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          vi.advanceTimersByTime(1000)
          expect((adapter as any).pendingTerminalWorkflowEvents.size).toBe(1)
        }
        expect(statusEvents.length).toBe(eventsBeforeRetries)
        vi.advanceTimersByTime(1000)
        expect((adapter as any).pendingTerminalWorkflowEvents.size).toBe(0)
      } finally {
        fixture.cleanup()
        vi.useRealTimers()
      }
    })

    it('reads a workflow Agent transcript line larger than one chunk in the same update', () => {
      const fixture = createWorkflowFixture()
      const agentId = 'agent-large-line'
      const transcriptPath = path.join(fixture.transcriptDir, `agent-${agentId}.jsonl`)
      try {
        writeFileSync(
          transcriptPath,
          `${JSON.stringify({
            type: 'assistant',
            uuid: crypto.randomUUID(),
            message: {
              id: 'message-large',
              usage: {
                input_tokens: 12_000,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 345
              },
              content: [
                { type: 'text', text: 'x'.repeat(300_000) },
                { type: 'tool_use', id: 'tool-large', name: 'Read', input: {} }
              ]
            }
          })}\n`
        )
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          description: 'Review a pull request',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'reviewer:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              agentId,
              state: 'progress'
            }
          ]
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalTokens: 12_345,
          totalCumulativeTokens: 12_345,
          totalToolCalls: 1,
          workflowProgress: expect.arrayContaining([
            expect.objectContaining({
              label: 'reviewer:main',
              tokens: 12_345,
              cumulativeTokens: 12_345,
              toolCalls: 1
            })
          ])
        })
      } finally {
        fixture.cleanup()
      }
    })

    it('continues a workflow transcript across bounded read passes', () => {
      const fixture = createWorkflowFixture()
      const agentId = 'agent-bounded-passes'
      const transcriptPath = path.join(fixture.transcriptDir, `agent-${agentId}.jsonl`)
      const assistantLine = (id: string, inputTokens: number, outputTokens: number, toolId: string) =>
        JSON.stringify({
          type: 'assistant',
          uuid: crypto.randomUUID(),
          message: {
            id,
            usage: {
              input_tokens: inputTokens,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: outputTokens
            },
            content: [
              { type: 'text', text: 'x'.repeat(300_000) },
              { type: 'tool_use', id: toolId, name: 'Read', input: {} }
            ]
          }
        })
      try {
        writeFileSync(
          transcriptPath,
          `${assistantLine('message-first', 100, 20, 'tool-first')}\n${assistantLine(
            'message-second',
            200,
            30,
            'tool-second'
          )}\n`
        )
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_started',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          tool_use_id: 'workflow-tool-use',
          task_type: 'local_workflow',
          workflow_name: 'review-pr',
          prompt: fixture.script
        } as any)
        const emitProgress = () =>
          adapter.handleMessage({
            type: 'system',
            subtype: 'task_progress',
            session_id: 'sdk-1',
            uuid: crypto.randomUUID(),
            task_id: fixture.taskId,
            tool_use_id: 'workflow-tool-use',
            workflow_progress: [
              { type: 'workflow_phase', index: 1, title: 'Review' },
              {
                type: 'workflow_agent',
                index: 1,
                label: 'reviewer:main',
                phaseIndex: 1,
                phaseTitle: 'Review',
                agentId,
                state: 'progress'
              }
            ]
          } as any)

        emitProgress()
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalCumulativeTokens: 120,
          totalToolCalls: 1
        })

        emitProgress()
        expect(statusEvents.at(-1)?.data.workflow).toMatchObject({
          totalCumulativeTokens: 350,
          totalToolCalls: 2
        })
      } finally {
        fixture.cleanup()
      }
    })

    it('ignores workflow snapshots larger than the bounded read limit', () => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot({ padding: 'x'.repeat(1_048_576) })
        const { adapter, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          description: 'Review progress',
          usage: { total_tokens: 120, tool_uses: 3, duration_ms: 1000 }
        } as any)

        expect(statusEvents.at(-1)?.data.workflow).toBeUndefined()
        expect(loggerMocks.warn).toHaveBeenCalledWith(
          'Skipped oversized workflow snapshot',
          expect.objectContaining({ taskId: fixture.taskId, snapshotPath: fixture.snapshotPath })
        )
      } finally {
        fixture.cleanup()
      }
    })

    it('keeps one terminal workflow snapshot in the transcript while publishing later terminal state', () => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot({
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'review:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 200,
              toolCalls: 4,
              durationMs: 2000
            }
          ],
          totalTokens: 200,
          totalToolCalls: 4
        })
        const { adapter, parts, statusEvents } = createAdapter()
        launchWorkflow(adapter, fixture)

        adapter.handleMessage({
          type: 'system',
          subtype: 'task_updated',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          patch: { status: 'completed', description: 'Review complete' }
        } as any)
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          description: 'Late progress',
          usage: { total_tokens: 200, tool_uses: 4, duration_ms: 2000 }
        } as any)
        fixture.writeSnapshot({
          workflowProgress: [
            { type: 'workflow_phase', index: 1, title: 'Review' },
            {
              type: 'workflow_agent',
              index: 1,
              label: 'review:main',
              phaseIndex: 1,
              phaseTitle: 'Review',
              state: 'done',
              tokens: 2400,
              toolCalls: 50,
              durationMs: 2400
            }
          ],
          totalTokens: 2400,
          totalToolCalls: 50
        })
        adapter.handleMessage({
          type: 'system',
          subtype: 'task_notification',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          status: 'completed',
          output_file: '/tmp/workflow-task-1.output',
          summary: 'Review complete'
        } as any)

        expect(
          statusEvents.filter((event) => event.type === 'background-task-event' && event.data.workflow)
        ).toHaveLength(3)
        const persistedTaskEvents = parts.flatMap((part) =>
          part.type === 'data-agent-task-event' && part.data.workflow ? [part] : []
        )
        expect(getLastBackgroundTaskEvent(statusEvents)?.data).toMatchObject({
          toolUseId: 'workflow-tool-use',
          workflow: { totalTokens: 2400, totalToolCalls: 50 }
        })
        expect(persistedTaskEvents).toHaveLength(1)
        expect(persistedTaskEvents.at(-1)?.data).toMatchObject({
          toolUseId: 'workflow-tool-use',
          workflow: { totalTokens: 200, totalToolCalls: 4 }
        })
      } finally {
        fixture.cleanup()
      }
    })

    it('rejects workflow snapshots whose path structure or embedded identity is not authoritative', () => {
      const fixture = createWorkflowFixture()
      try {
        fixture.writeSnapshot({ taskId: 'different-task' })
        const first = createAdapter()
        launchWorkflow(first.adapter, fixture)
        first.adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          description: 'Review progress',
          usage: { total_tokens: 120, tool_uses: 3, duration_ms: 1000 }
        } as any)
        expect(first.statusEvents.at(-1)?.data.workflow).toBeUndefined()

        fixture.writeSnapshot()
        const second = createAdapter()
        launchWorkflow(second.adapter, fixture, { transcriptDir: path.join(fixture.projectRoot, fixture.runId) })
        second.adapter.handleMessage({
          type: 'system',
          subtype: 'task_progress',
          session_id: 'sdk-1',
          uuid: crypto.randomUUID(),
          task_id: fixture.taskId,
          description: 'Review progress',
          usage: { total_tokens: 120, tool_uses: 3, duration_ms: 1000 }
        } as any)
        expect(second.statusEvents.at(-1)?.data.workflow).toBeUndefined()
      } finally {
        fixture.cleanup()
      }
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

    it('uses local workflow task starts to enrich navigation without changing authoritative membership', () => {
      const { adapter, statusEvents } = createAdapter()

      adapter.handleMessage({
        type: 'system',
        subtype: 'background_tasks_changed',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        tasks: [{ task_id: 'workflow-1', task_type: 'local_workflow', description: 'Review the pull request' }]
      } as any)
      adapter.handleMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'sdk-1',
        uuid: crypto.randomUUID(),
        task_id: 'workflow-1',
        tool_use_id: 'workflow-tool-use',
        description: 'Review the pull request',
        task_type: 'local_workflow'
      } as any)

      expect(statusEvents.filter((event) => event.type === 'background-tasks')).toEqual([
        {
          type: 'background-tasks',
          tasks: [{ id: 'workflow-1', type: 'local_workflow', description: 'Review the pull request' }]
        },
        {
          type: 'background-tasks',
          tasks: [
            {
              id: 'workflow-1',
              type: 'local_workflow',
              description: 'Review the pull request',
              toolCallId: 'workflow-tool-use'
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

      // Empty membership is delivered before the terminal edge, so presentation retains the task.
      expect(statusEvents.at(-1)).toEqual({
        type: 'background-tasks',
        tasks: [{ id: 'bg-1', type: 'subagent', description: 'Audit the codebase' }]
      })
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
      expect(statusEvents.slice(-2)).toEqual([
        expect.objectContaining({
          type: 'background-task-event',
          data: expect.objectContaining({ event: 'notification', taskId: 'bg-1', status: 'completed' })
        }),
        { type: 'background-tasks', tasks: [] }
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
        'background-tasks',
        'autonomous-turn-state',
        'autonomous-turn-state'
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

      expect(statusEvents).toEqual([{ type: 'autonomous-turn-state', state: 'started' }])
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
        { type: 'autonomous-turn-state', state: 'started' },
        { type: 'autonomous-turn-state', state: 'finished' }
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
      expect(statusEvents).not.toContainEqual({ type: 'autonomous-turn-state', state: 'started' })
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
