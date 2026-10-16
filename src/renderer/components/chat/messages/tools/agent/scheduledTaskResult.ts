import { isToolUIPart } from 'ai'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { CRON_TOOL_NAME } from '@shared/ai/builtinTools'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

const CHERRY_TOOLS_SERVER_ID = 'cherry-tools'
const TASK_WRITE_ACTIONS = new Set(['add', 'update'])
// saveJob in cherryAutonomyTools reports `Job created:` / `Job updated:` followed by the task JSON.
const TASK_WRITE_OUTPUT_PATTERN = /^Job (?:created|updated):\s*/

export interface ScheduledTaskResult {
  taskId: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function outputText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const content = isRecord(value) ? value.content : value
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content.map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : '')).join('\n')
}

export function parseScheduledTaskResult(value: unknown): ScheduledTaskResult | undefined {
  const text = outputText(value)?.trim()
  if (!text || !TASK_WRITE_OUTPUT_PATTERN.test(text)) return undefined

  let task: unknown
  try {
    task = JSON.parse(text.replace(TASK_WRITE_OUTPUT_PATTERN, ''))
  } catch {
    return undefined
  }
  if (!isRecord(task) || typeof task.id !== 'string' || typeof task.name !== 'string') return undefined
  return { taskId: task.id, name: task.name }
}

function isTaskWriteToolResponse(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const { tool } = toolResponse
  if (tool.type !== 'mcp' || !('serverId' in tool) || tool.serverId !== CHERRY_TOOLS_SERVER_ID) return false
  if (tool.name !== CRON_TOOL_NAME) return false
  const action = isRecord(toolResponse.arguments) ? toolResponse.arguments.action : undefined
  return typeof action === 'string' && TASK_WRITE_ACTIONS.has(action)
}

export function getScheduledTaskResult(
  toolResponse: McpToolResponse | NormalToolResponse
): ScheduledTaskResult | undefined {
  if (toolResponse.status !== 'done' || !isTaskWriteToolResponse(toolResponse)) return undefined
  return parseScheduledTaskResult(toolResponse.response)
}

/** Decided from the call input so a deferred (not yet loaded) output still lands in the result lane. */
export function isScheduledTaskResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false

  const toolResponse = buildToolResponseFromPart(part)
  return !!toolResponse && isTaskWriteToolResponse(toolResponse)
}
