import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessagePart } from 'ai'
import { isToolUIPart } from 'ai'

import {
  type AskUserQuestionToolInput,
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '../../messages/tools/agent/types'
import { APPROVAL_REQUESTED } from '../../messages/tools/toolResponse'

export type AskUserQuestionComposerRequest = {
  messageId: string
  toolCallId: string
  approvalId: string
  input: AskUserQuestionToolInput
  match: MessageToolApprovalMatch
}

type AskUserQuestionToolPart = CherryMessagePart & {
  type: string
  toolName?: string
  toolCallId: string
  state?: string
  input?: unknown
  approval?: { id?: string }
}

function getToolName(part: AskUserQuestionToolPart): string {
  if (part.toolName?.trim()) return part.toolName
  if (part.type.startsWith('tool-')) return part.type.replace(/^tool-/, '')
  return ''
}

export function findLatestPendingAskUserQuestionRequest(
  partsByMessageId: Record<string, CherryMessagePart[]>
): AskUserQuestionComposerRequest | null {
  let latest: AskUserQuestionComposerRequest | null = null

  for (const [messageId, parts] of Object.entries(partsByMessageId)) {
    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<never, never>)) continue

      const toolPart = part as AskUserQuestionToolPart
      const approvalId = toolPart.approval?.id
      if (!isAskUserQuestionToolName(getToolName(toolPart)) || toolPart.state !== APPROVAL_REQUESTED || !approvalId) {
        continue
      }

      const input = parseAskUserQuestionToolInput(toolPart.input)
      if (!input?.questions.length) continue

      latest = {
        messageId,
        toolCallId: toolPart.toolCallId,
        approvalId,
        input,
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
