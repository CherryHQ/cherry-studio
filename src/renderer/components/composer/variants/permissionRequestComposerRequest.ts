import type { DynamicToolUIPart, ToolUIPart, UITools } from 'ai'
import { isToolUIPart } from 'ai'
import * as z from 'zod'

import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { getPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import {
  APPROVAL_REQUESTED,
  buildToolResponseFromPart,
  type ToolResponseLike
} from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
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

type PermissionToolPart = ToolUIPart<UITools> | DynamicToolUIPart

const commandPolicyRuleSchema = z.object({ ruleId: z.string(), reasonCode: z.string(), evidence: z.string() })
const commandPolicySchema = z.object({
  cwd: z.string().optional(),
  reason: z.string(),
  revision: z.string(),
  rules: z.array(z.unknown()).transform((rules) =>
    rules.flatMap((rule) => {
      const parsed = commandPolicyRuleSchema.safeParse(rule)
      return parsed.success ? [parsed.data] : []
    })
  )
})

/** States in which a call is already decided or finished, so it must never prompt again. */
const RESOLVED_TOOL_STATES: ReadonlySet<string> = new Set([
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied'
])

function getToolName(part: PermissionToolPart): string {
  // oxlint-disable-next-line anti-slop/no-reflect-get -- Historical static tool parts can expose a toolName extension; retain its original inherited/virtual read without claiming it is an SDK field.
  const toolName: unknown = Reflect.get(part, 'toolName')

  if (typeof toolName === 'string' && toolName.trim()) return toolName

  if (part.type.startsWith('tool-')) return part.type.replace(/^tool-/, '')

  return ''
}

function getToolDisplayName(toolResponse: ToolResponseLike): string {
  return toolResponse.tool.name
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Permission UI reads versioned runtime tool inputs; only nonempty string fields may become a display title.
function getStringField(value: unknown, fields: string[]): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  for (const field of fields) {
    // oxlint-disable-next-line anti-slop/no-reflect-get -- Runtime-defined title fields retain inherited and virtual property reads; only nonblank strings are consumed.
    const candidate: unknown = Reflect.get(value, field)

    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return undefined
}

function getPermissionTitle(part: PermissionToolPart, fallback: string): string {
  return getStringField(part.input, ['question', 'message', 'prompt', 'title', 'description', 'path']) ?? fallback
}

/** Return the FIFO head from the newest reply that has pending tool permissions. */
function getCommandPolicy(part: PermissionToolPart): CommandApprovalDetails | undefined {
  const source: {
    readonly providerMetadata?: unknown
    readonly callProviderMetadata?: unknown
    readonly resultProviderMetadata?: unknown
  } = part

  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata'] as const) {
    const metadata = source[field]

    if (!metadata || typeof metadata !== 'object' || !('cherry' in metadata)) continue
    const cherry = metadata.cherry

    if (!cherry || typeof cherry !== 'object' || !('commandPolicy' in cherry)) continue
    const policy = cherry.commandPolicy

    const parsed = commandPolicySchema.safeParse(policy)

    if (parsed.success) {
      const { cwd, ...details } = parsed.data
      return cwd === undefined ? details : { cwd, ...details }
    }
  }

  return undefined
}

export function findNextPendingPermissionRequest(
  partsByMessageId: Record<string, CherryMessagePart[]>,
  sourcePartsByMessageId = partsByMessageId
): PermissionRequestComposerRequest | null {
  const messages = Object.entries(partsByMessageId)

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const [messageId, parts] = messages[messageIndex]

    for (const part of parts) {
      if (!isToolUIPart(part)) continue

      const toolPart = part
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

      const parentToolCallId = getPartParentToolCallId(part)
      const allParts = Object.values(sourcePartsByMessageId).flat()

      const parent = parentToolCallId
        ? allParts.find((candidate) => isToolUIPart(candidate) && candidate.toolCallId === parentToolCallId)
        : undefined

      const taskEvents = parentToolCallId
        ? allParts.flatMap((candidate) =>
            candidate.type === 'data-agent-task-event' && candidate.data.toolUseId === parentToolCallId
              ? [candidate.data]
              : []
          )
        : []

      const origin: Pick<PermissionRequestComposerRequest, 'source'> = {}

      if (parentToolCallId) {
        origin.source = {
          toolCallId: parentToolCallId,
          title:
            taskEvents.findLast((event) => event.title)?.title ??
            getStringField(parent && 'input' in parent ? parent.input : undefined, ['description', 'title', 'prompt']),
          isBackgrounded: taskEvents.findLast((event) => event.isBackgrounded !== undefined)?.isBackgrounded
        }
      }

      return {
        ...origin,
        commandPolicy: getCommandPolicy(toolPart),
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
