import { describe, expect, it } from 'vitest'

import { buildToolResponseFromPart } from '@renderer/components/chat/messages/tools/toolResponse'
import type { CherryMessagePart } from '@shared/data/types/message'

import { getScheduledTaskResult, isScheduledTaskResultPart, parseScheduledTaskResult } from '../scheduledTaskResult'

const TASK_JSON = JSON.stringify({ id: 'task-1', agentId: 'agent-1', name: 'Gold price', status: 'active' }, null, 2)
const CHERRY_TOOLS_METADATA = { type: 'mcp', name: 'cron', serverName: 'cherry-tools', serverId: 'cherry-tools' }

function cronPart(overrides: Record<string, unknown> = {}): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'cron-1',
    toolName: 'mcp__cherry-tools__cron',
    state: 'output-available',
    input: { action: 'add', name: 'Gold price', message: 'Check the gold price', cron: '0 21 * * *' },
    output: { content: `Job created:\n${TASK_JSON}`, metadata: CHERRY_TOOLS_METADATA },
    ...overrides
  }
}

describe('parseScheduledTaskResult', () => {
  it.each([
    ['plain text', `Job created:\n${TASK_JSON}`],
    ['an MCP text content list', { content: [{ type: 'text', text: `Job updated:\n${TASK_JSON}` }] }],
    ['a content string', { content: `Job created:\n${TASK_JSON}` }]
  ])('reads the written task from %s', (_label, output) => {
    expect(parseScheduledTaskResult(output)).toEqual({ taskId: 'task-1', name: 'Gold price' })
  })

  it.each([
    ['a job list', 'Jobs:\n[]'],
    ['a removal notice', 'Job "task-1" removed'],
    ['truncated JSON', 'Job created:\n{"id": "task-1"'],
    ['a task without an id', `Job created:\n${JSON.stringify({ name: 'Gold price' })}`]
  ])('rejects %s', (_label, output) => {
    expect(parseScheduledTaskResult(output)).toBeUndefined()
  })
})

describe('scheduled task tool results', () => {
  it('turns a completed cherry-tools cron write into a scheduled task result', () => {
    const toolResponse = buildToolResponseFromPart(cronPart())

    expect(isScheduledTaskResultPart(cronPart())).toBe(true)
    expect(getScheduledTaskResult(toolResponse!)).toEqual({ taskId: 'task-1', name: 'Gold price' })
  })

  it('keeps a write in the result lane before its deferred output has loaded', () => {
    const deferred = cronPart({
      output: { $deferredToolResult: { topicId: 'topic-1', messageId: 'message-1', toolCallId: 'cron-1' } }
    })

    expect(isScheduledTaskResultPart(deferred)).toBe(true)
  })

  it.each([
    ['a list call', cronPart({ input: { action: 'list' }, output: { content: 'Jobs:\n[]' } })],
    ['a removal', cronPart({ input: { action: 'remove', id: 'task-1' } })],
    ['a failed write', cronPart({ state: 'output-error', errorText: 'Job "x" not found' })],
    [
      'a cron tool from another MCP server',
      cronPart({
        toolName: 'mcp__ops__cron',
        output: { content: `Job created:\n${TASK_JSON}`, metadata: { ...CHERRY_TOOLS_METADATA, serverId: 'ops' } }
      })
    ]
  ])('does not treat %s as a scheduled task card', (_label, part) => {
    const toolResponse = buildToolResponseFromPart(part)

    expect(isScheduledTaskResultPart(part)).toBe(false)
    expect(toolResponse && getScheduledTaskResult(toolResponse)).toBeFalsy()
  })
})
