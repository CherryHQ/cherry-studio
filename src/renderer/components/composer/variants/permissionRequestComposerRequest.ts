import type { UIMessagePart } from 'ai'
import { isToolUIPart } from 'ai'

import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import {
  APPROVAL_REQUESTED,
  buildToolResponseFromPart,
  type ToolResponseLike
} from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'

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
  approval?: { id?: string; approved?: boolean }
}

/** States in which a call is already decided or finished, so it must never prompt again. */
const RESOLVED_TOOL_STATES: ReadonlySet<string> = new Set([
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied'
])

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
  return getStringField(part.input, ['question', 'message', 'prompt', 'title', 'description', 'path']) ?? fallback
}

/** Return the FIFO head from the newest reply that has pending tool permissions. */
export function findNextPendingPermissionRequest(
  partsByMessageId: Record<string, CherryMessagePart[]>
): PermissionRequestComposerRequest | null {
  const messages = Object.entries(partsByMessageId)
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const [messageId, parts] = messages[messageIndex]

    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<never, never>)) continue

      const toolPart = part as PermissionToolPart
      const toolName = getToolName(toolPart)
      const approvalId = toolPart.approval?.id
      if (toolName === AgentToolsType.AskUserQuestion || !approvalId) continue
      // A provider-executed dynamic tool part can carry the approval id while its state never
      // reaches `approval-requested`; an unresolved approval still needs a person to decide.
      const partState = toolPart.state ?? ''
      const awaitingApproval =
        partState === APPROVAL_REQUESTED ||
        (!RESOLVED_TOOL_STATES.has(partState) && toolPart.approval?.approved === undefined)
      if (!awaitingApproval) continue

      const toolResponse = buildToolResponseFromPart(part)
      if (!toolResponse) continue

      return {
        messageId,
        toolCallId: toolPart.toolCallId,
        approvalId,
        title: getPermissionTitle(toolPart, getToolDisplayName(toolResponse)),
        toolResponse,
        match: {
          part,
          state: partState,
          toolCallId: toolPart.toolCallId,
          messageId,
          approvalId,
          input: toolPart.input
        }
      }
    }
  }

  return null
}
