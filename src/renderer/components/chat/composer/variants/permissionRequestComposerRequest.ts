import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessagePart } from 'ai'
import { isToolUIPart } from 'ai'

import { AgentToolsType } from '../../messages/tools/agent'
import { APPROVAL_REQUESTED, buildToolResponseFromPart, type ToolResponseLike } from '../../messages/tools/toolResponse'

export type PermissionRequestComposerRequest = {
  messageId: string
  toolCallId: string
  approvalId: string
  title: string
  toolResponse: ToolResponseLike
  match: MessageToolApprovalMatch
}

type PermissionToolPart = CherryMessagePart & {
  type: string
  toolName?: string
  toolCallId: string
  state?: string
  input?: unknown
  approval?: { id?: string }
}

function getToolName(part: PermissionToolPart): string {
  if (part.toolName?.trim()) return part.toolName
  if (part.type.startsWith('tool-')) return part.type.replace(/^tool-/, '')
  return ''
}

function getToolDisplayName(toolResponse: ToolResponseLike): string {
  return toolResponse.tool.name
}

function getStringField(value: unknown, fields: string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as Record<string, unknown>
  for (const field of fields) {
    const candidate = record[field]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return undefined
}

function getPermissionTitle(part: PermissionToolPart, fallback: string): string {
  return getStringField(part.input, ['question', 'message', 'prompt', 'title', 'description']) ?? fallback
}

export function findLatestPendingPermissionRequest(
  partsByMessageId: Record<string, CherryMessagePart[]>
): PermissionRequestComposerRequest | null {
  let latest: PermissionRequestComposerRequest | null = null

  for (const [messageId, parts] of Object.entries(partsByMessageId)) {
    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<never, never>)) continue

      const toolPart = part as PermissionToolPart
      const toolName = getToolName(toolPart)
      const approvalId = toolPart.approval?.id
      if (toolName === AgentToolsType.AskUserQuestion || toolPart.state !== APPROVAL_REQUESTED || !approvalId) {
        continue
      }

      const toolResponse = buildToolResponseFromPart(part)
      if (!toolResponse) continue

      latest = {
        messageId,
        toolCallId: toolPart.toolCallId,
        approvalId,
        title: getPermissionTitle(toolPart, getToolDisplayName(toolResponse)),
        toolResponse,
        match: {
          part,
          state: toolPart.state,
          toolCallId: toolPart.toolCallId,
          messageId,
          approvalId,
          input: toolPart.input
        }
      }
    }
  }

  return latest
}
