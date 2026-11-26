import { isToolUIPart } from 'ai'

import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { getPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import {
  APPROVAL_REQUESTED,
  buildToolResponseFromPart,
  type ToolResponseLike
} from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import { messagePartEntries, type MessagePartRows } from '@renderer/utils/message/messagePartRows'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CommandApprovalDetails } from '@shared/data/types/uiParts'

export type PermissionRequestComposerRequest = {
  messageId: string
  toolCallId: string
  approvalId: string
  title: string
  toolResponse: ToolResponseLike
  match: MessageToolApprovalMatch
  commandPolicy?: CommandApprovalDetails
  source?: { toolCallId: string; title?: string; isBackgrounded?: boolean }
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
function getCommandPolicy(part: PermissionToolPart): CommandApprovalDetails | undefined {
  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata'] as const) {
    const metadata = part[field]
    if (!metadata || typeof metadata !== 'object') continue
    const cherry = metadata.cherry
    if (!cherry || typeof cherry !== 'object') continue
    const policy = cherry.commandPolicy
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) continue
    if (
      (policy.cwd !== undefined && typeof policy.cwd !== 'string') ||
      typeof policy.reason !== 'string' ||
      typeof policy.revision !== 'string' ||
      !Array.isArray(policy.rules)
    )
      continue
    return {
      ...(typeof policy.cwd === 'string' ? { cwd: policy.cwd } : {}),
      reason: policy.reason,
      revision: policy.revision,
      rules: policy.rules.flatMap((rule) =>
        rule &&
        typeof rule === 'object' &&
        !Array.isArray(rule) &&
        typeof rule.ruleId === 'string' &&
        typeof rule.reasonCode === 'string' &&
        typeof rule.evidence === 'string'
          ? [{ ruleId: rule.ruleId, reasonCode: rule.reasonCode, evidence: rule.evidence }]
          : []
      )
    }
  }
  return undefined
}

export function isPendingApprovalPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || !part.approval?.id) return false
  // Some provider-executed tools carry an unresolved id before reporting approval-requested.
  return (
    part.state === APPROVAL_REQUESTED || (!RESOLVED_TOOL_STATES.has(part.state) && part.approval.approved === undefined)
  )
}

function permissionSource(rows: MessagePartRows, toolCallId: string): PermissionRequestComposerRequest['source'] {
  let parentTitle: string | undefined
  let eventTitle: string | undefined
  let isBackgrounded: boolean | undefined
  for (const [, parts] of messagePartEntries(rows)) {
    for (const part of parts) {
      if (isToolUIPart(part) && part.toolCallId === toolCallId) {
        parentTitle ??= getStringField(part.input, ['description', 'title', 'prompt'])
      } else if (part.type === 'data-agent-task-event' && part.data.toolUseId === toolCallId) {
        if (part.data.title) eventTitle = part.data.title
        isBackgrounded = part.data.isBackgrounded ?? isBackgrounded
      }
    }
  }
  return { toolCallId, title: eventTitle ?? parentTitle, isBackgrounded }
}

export function findNextPendingPermissionRequest(
  partsByMessageId: MessagePartRows,
  sourcePartsByMessageId = partsByMessageId
): PermissionRequestComposerRequest | null {
  const messages = [...messagePartEntries(partsByMessageId)]
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const [messageId, parts] = messages[messageIndex]

    for (const part of parts) {
      if (!isPendingApprovalPart(part)) continue

      const toolPart = part as PermissionToolPart
      const toolName = getToolName(toolPart)
      const approvalId = toolPart.approval?.id
      if (toolName === AgentToolsType.AskUserQuestion || !approvalId) continue
      const toolResponse = buildToolResponseFromPart(part)
      if (!toolResponse) continue

      const parentToolCallId = getPartParentToolCallId(part)
      return {
        ...(parentToolCallId && { source: permissionSource(sourcePartsByMessageId, parentToolCallId) }),
        commandPolicy: getCommandPolicy(toolPart),
        messageId,
        toolCallId: toolPart.toolCallId,
        approvalId,
        title: getPermissionTitle(toolPart, getToolDisplayName(toolResponse)),
        toolResponse,
        match: {
          part,
          state: toolPart.state ?? '',
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
