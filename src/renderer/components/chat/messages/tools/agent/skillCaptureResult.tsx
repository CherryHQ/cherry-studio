import { isToolUIPart } from 'ai'

import { useOptionalMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'
import { SkillCaptureRefSchema, type SkillCaptureRef } from '@shared/types/skillCapture'

import { buildToolResponseFromPart } from '../toolResponse'

export type SkillCapturePresentation = SkillCaptureRef & { revision?: string; generationMessageId?: string }

function isCaptureTool(response: McpToolResponse | NormalToolResponse) {
  const { tool } = response
  if (['mcp__skills__suggest_skill', 'mcp__skills__prepare_skill_draft'].includes(tool.name)) return true
  return (
    tool.type === 'mcp' &&
    'serverId' in tool &&
    tool.serverId === 'skills' &&
    (tool.name === 'suggest_skill' || tool.name === 'prepare_skill_draft')
  )
}

export function getSkillCaptureResult(
  response: McpToolResponse | NormalToolResponse
): SkillCapturePresentation | undefined {
  if (response.status !== 'done' || !isCaptureTool(response)) return undefined
  let value: unknown = response.response
  if (value && typeof value === 'object' && 'isError' in value && value.isError) return undefined
  if (value && typeof value === 'object' && 'content' in value) value = value.content
  if (Array.isArray(value)) value = value.map((item) => (item?.type === 'text' ? item.text : '')).join('\n')
  try {
    if (typeof value === 'string') value = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true) return undefined
  const parsed = SkillCaptureRefSchema.safeParse({
    sessionId: 'sessionId' in value ? value.sessionId : undefined,
    messageId: 'messageId' in value ? value.messageId : undefined
  })
  if (!parsed.success) return undefined
  return {
    ...parsed.data,
    ...('generationMessageId' in value && typeof value.generationMessageId === 'string'
      ? { generationMessageId: value.generationMessageId }
      : {}),
    ...('revision' in value && typeof value.revision === 'string' ? { revision: value.revision } : {})
  }
}

export function isSkillCaptureResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false
  const response = buildToolResponseFromPart(part)
  return !!response && isCaptureTool(response)
}

export function SkillCaptureTool({ result }: { result: SkillCapturePresentation }) {
  const render = useOptionalMessageListActions()?.renderSkillCapture
  return render?.(result) ?? null
}
