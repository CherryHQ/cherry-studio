import { describe, expect, it } from 'vitest'

import type { ClaudeControl } from '@cherrystudio/agent-runtime-claude-code'
import { serializeError } from '@main/ai/utils/serializeError'

import { ClaudeCodeResultError, claudeControlEvents } from '../ClaudeRuntimeState'

describe('Claude product control mapping', () => {
  const identity = { session_id: 'native', uuid: crypto.randomUUID() }

  it.each([400, 401, 429, 503])('preserves native HTTP %i for product error handling', (statusCode) => {
    const error = new ClaudeCodeResultError({
      message: 'failed',
      subtype: 'success',
      errors: ['failed'],
      terminalReason: 'api_error',
      statusCode
    })
    expect(serializeError(error)).toMatchObject({ statusCode, message: 'failed' })
  })

  it('includes all input buckets and the native reasoning estimate in display statistics', () => {
    expect(
      claudeControlEvents({
        type: 'result',
        sessionId: 'native',
        terminal: true,
        reasoningTokens: 4,
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 11
        } as never
      })
    ).toMatchObject([
      {
        type: 'chunk',
        chunk: {
          type: 'message-metadata',
          messageMetadata: {
            stats: {
              inputTokens: 21,
              outputTokens: 5,
              totalTokens: 26,
              outputTokenDetails: { reasoningTokens: 4 }
            }
          }
        }
      }
    ])
  })

  it('uses the task summary as its title while retaining current activity and measured usage', () => {
    expect(
      claudeControlEvents({
        type: 'background-task-event',
        data: {
          status: 'in_progress',
          message: {
            ...identity,
            type: 'system',
            subtype: 'task_progress',
            task_id: 'child',
            tool_use_id: 'spawn',
            description: 'Reading files',
            summary: 'Checking dependencies',
            last_tool_name: 'Read',
            usage: { total_tokens: 42, tool_uses: 2, duration_ms: 300 }
          }
        }
      })
    ).toMatchObject([
      {
        type: 'background-task-event',
        data: {
          taskId: 'child',
          toolUseId: 'spawn',
          status: 'in_progress',
          title: 'Checking dependencies',
          activeText: 'Reading files',
          lastToolName: 'Read',
          usage: { totalTokens: 42, toolUses: 2, durationMs: 300 }
        }
      }
    ])
  })

  it('does not invent running state or usage when a task patch only changes presentation', () => {
    expect(
      claudeControlEvents({
        type: 'background-task-event',
        data: {
          message: {
            ...identity,
            type: 'system',
            subtype: 'task_updated',
            task_id: 'child',
            patch: { description: 'Updated title', is_backgrounded: false }
          }
        }
      })
    ).toEqual([
      {
        type: 'background-task-event',
        data: {
          event: 'updated',
          taskId: 'child',
          title: 'Updated title',
          description: 'Updated title',
          isBackgrounded: false
        }
      }
    ])
  })

  it('keeps stopped task output readable without fabricating usage', () => {
    expect(
      claudeControlEvents({
        type: 'background-task-event',
        data: {
          status: 'stopped',
          message: {
            ...identity,
            type: 'system',
            subtype: 'task_notification',
            task_id: 'child',
            status: 'stopped',
            summary: 'Partial findings',
            output_file: 'child.txt'
          }
        }
      })
    ).toEqual([
      {
        type: 'background-task-event',
        data: {
          event: 'notification',
          taskId: 'child',
          status: 'stopped',
          summary: 'Partial findings',
          outputFile: 'child.txt',
          skipTranscript: false
        }
      }
    ])
  })

  it.each([
    {
      type: 'api-retry',
      retry: {
        ...identity,
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 2000,
        error_status: null,
        error: 'server_error'
      }
    },
    {
      type: 'api-retry',
      retry: {
        agent_id: 'child',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 2000,
        error_status: null,
        error_category: 'server_error'
      },
      subagentType: 'Explore'
    }
  ] satisfies Extract<ClaudeControl, { type: 'api-retry' }>[])(
    'retains backoff timing and source for $subagentType',
    (control) => {
      expect(claudeControlEvents(control)).toEqual([
        {
          type: 'api-retry',
          retry: {
            attempt: 1,
            maxRetries: 3,
            retryDelayMs: 2000,
            errorStatus: null,
            errorCategory: 'server_error',
            subagentType: control.subagentType
          }
        }
      ])
    }
  )

  it('keeps zero compaction measurements and does not fabricate an anchor without metadata', () => {
    const completedAt = '2026-11-05T00:00:00.000Z'
    expect(
      claudeControlEvents({
        type: 'compaction-complete',
        anchor: { trigger: 'manual', pre_tokens: 0, post_tokens: 0, duration_ms: 0, completedAt }
      })
    ).toEqual([
      {
        type: 'compaction-complete',
        anchor: {
          status: 'done',
          phase: 'agent-session',
          trigger: 'manual',
          preTokens: 0,
          postTokens: 0,
          durationMs: 0,
          completedAt
        }
      }
    ])
    expect(claudeControlEvents({ type: 'compaction-complete' })).toEqual([{ type: 'compaction-complete' }])
  })
})
