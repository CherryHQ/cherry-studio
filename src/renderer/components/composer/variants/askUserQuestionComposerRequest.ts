import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import { isToolUIPart } from 'ai'

import {
  type AskUserQuestionToolInput,
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { APPROVAL_REQUESTED } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'

export type AskUserQuestionComposerRequest = {
  messageId: string
  toolCallId: string
  approvalId: string
  input: AskUserQuestionToolInput
  match: MessageToolApprovalMatch
}

function getToolName(part: ToolUIPart | DynamicToolUIPart): string {
  if (part.type === 'dynamic-tool' && part.toolName.trim()) return part.toolName

  if (part.type.startsWith('tool-')) return part.type.replace(/^tool-/, '')

  return ''
}

export function findLatestPendingAskUserQuestionRequest(
  partsByMessageId: Record<string, CherryMessagePart[]>
): AskUserQuestionComposerRequest | null {
  let latest: AskUserQuestionComposerRequest | null = null

  for (const [messageId, parts] of Object.entries(partsByMessageId)) {
    for (const part of parts) {
      if (!isToolUIPart(part)) continue

      const approvalId = part.approval?.id

      if (!isAskUserQuestionToolName(getToolName(part)) || part.state !== APPROVAL_REQUESTED || !approvalId) {
        continue
      }

      const input = parseAskUserQuestionToolInput(part.input)

      if (!input?.questions.length) continue

      latest = {
        messageId,
        toolCallId: part.toolCallId,
        approvalId,
        input,
        match: {
          part,
          state: part.state,
          toolCallId: part.toolCallId,
          messageId,
          approvalId,
          input: part.input
        }
      }
    }
  }

  return latest
}
