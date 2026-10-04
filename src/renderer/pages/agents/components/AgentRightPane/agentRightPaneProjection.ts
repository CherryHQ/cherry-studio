import { getToolName, isToolUIPart } from 'ai'

import { loggerService } from '@logger'
import {
  type AgentToolOutput,
  AgentToolsType,
  buildAgentLaunchIndex,
  extractLaunchReceiptId,
  getResumedAgentId,
  isBackgroundAgentOutput,
  resolveResumeReceiptState
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import {
  getPartLaunchToolCallId,
  getPartParentToolCallId,
  getPartResumeMarker,
  stripPartParentToolMetadata
} from '@renderer/components/chat/messages/tools/toolParentMetadata'
import { getCanonicalToolName } from '@renderer/components/chat/messages/tools/toolResponse'
import type { AgentSessionTaskEvents } from '@shared/ai/agentSessionBackgroundTasks'
import { type DeferredToolResultRef, isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

// TEMPORARY diagnostic — removed once the cold-restart round ordering is diagnosed.
const probeLogger = loggerService.withContext('AgentFlowOrderProbe')

export type AgentRightPaneTab = 'browser' | 'files' | 'status' | `flow:${string}`

export interface AgentToolFlowOpenInput {
  toolCallId: string
  toolName?: string
  title?: string
}

export interface AgentToolFlowNode {
  title?: string
  toolCallId: string
  toolName: string
  parentToolCallId?: string
  messageId: string
  partIndex: number
  state?: string
}

export interface AgentToolFlowProjection {
  selectedTool?: AgentToolFlowNode
  toolNodes: AgentToolFlowNode[]
  selectedToolCallIds: Set<string>
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

/**
 * An item on the main agent's own plan — written incrementally through the task ledger
 * (`TaskCreate` / `TaskUpdate` / `TaskList`) or as a full-list `TodoWrite` snapshot.
 * Completion is meaningful here, so this is the only list with a done/total ratio.
 */

const strippedParentMetadataCache = new WeakMap<object, CherryMessagePart>()

function getPartWithoutParentMetadata(part: CherryMessagePart): CherryMessagePart {
  if (typeof part !== 'object' || part === null) return stripPartParentToolMetadata(part)
  const cached = strippedParentMetadataCache.get(part)
  if (cached) return cached
  const stripped = stripPartParentToolMetadata(part)
  strippedParentMetadataCache.set(part, stripped)
  return stripped
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getToolCallId(part: CherryMessagePart): string | undefined {
  const toolCallId = (part as unknown as { toolCallId?: unknown }).toolCallId
  return typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined
}

export function getToolPartState(part: CherryMessagePart): string | undefined {
  const state = (part as unknown as { state?: unknown }).state
  return typeof state === 'string' ? state : undefined
}

export function getToolPartInput(part: CherryMessagePart): unknown {
  return (part as unknown as { input?: unknown }).input
}

export function getToolPartOutput(part: CherryMessagePart): unknown {
  const output = (part as unknown as { output?: unknown }).output
  if (isRecord(output) && 'content' in output) return output.content
  return output
}

export function getToolNameFromPart(part: CherryMessagePart): string | undefined {
  if (!isToolUIPart(part)) return undefined
  const toolName = getToolName(part)
  return toolName.trim() || undefined
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item
        if (isRecord(item) && typeof item.text === 'string') return item.text
        return undefined
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    return text || undefined
  }
  if (!isRecord(value)) return undefined

  for (const key of ['content', 'result', 'message', 'text', 'prompt']) {
    const text = textFromContent(value[key])
    if (text) return text
  }

  const json = JSON.stringify(value, null, 2)
  return json === '{}' ? undefined : json
}

function getToolPromptText(part: CherryMessagePart | undefined): string | undefined {
  if (!part) return undefined
  const input = getToolPartInput(part)
  if (typeof input === 'string') return input.trim() || undefined
  if (!isRecord(input)) return undefined

  // A flow rooted at a resume receipt has no launch prompt: the round it opens was requested by
  // the message that receipt delivered.
  if (getCanonicalToolName(part) === AgentToolsType.SendMessage) return getResumeReceiptPromptText(part)
  return textFromContent(input.prompt) ?? textFromContent(input.description)
}

function isBackgroundAgentLaunchReceipt(output: unknown, text: string | undefined): boolean {
  return (
    isBackgroundAgentOutput(output as AgentToolOutput | undefined) ||
    // Receipt wording varies across CLI versions (`Async agent launched successfully.` /
    // `done.`), so the shared parser's structural markers decide, not a single prefix.
    (typeof text === 'string' && extractLaunchReceiptId(text) !== undefined)
  )
}

function createFlowTextMessage(
  id: string,
  role: CherryUIMessage['role'],
  text: string | undefined,
  createdAt: string
): CherryUIMessage | undefined {
  if (!text?.trim()) return undefined
  return {
    id,
    role,
    parts: [{ type: 'text', text }] as CherryMessagePart[],
    metadata: {
      createdAt,
      status: role === 'assistant' ? 'success' : undefined
    }
  }
}

function getStableMessageCreatedAt(message: CherryUIMessage | undefined): string | null {
  const createdAt = (message as unknown as { createdAt?: unknown } | undefined)?.createdAt
  return message?.metadata?.createdAt ?? (typeof createdAt === 'string' ? createdAt : null)
}

function getMessageCreatedAt(message: CherryUIMessage | undefined): string {
  return getStableMessageCreatedAt(message) ?? new Date(0).toISOString()
}

function getOrderedMessageParts(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): Array<{ message: CherryUIMessage; parts: CherryMessagePart[] }> {
  const entries = messages.map((message) => ({
    message,
    parts: partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
  }))
  const seenMessageIds = new Set(messages.map((message) => message.id))

  for (const [messageId, parts] of Object.entries(partsByMessageId)) {
    if (seenMessageIds.has(messageId)) continue
    entries.push({
      message: {
        id: messageId,
        role: 'assistant',
        parts,
        metadata: {
          status: 'pending',
          createdAt: new Date(0).toISOString()
        }
      },
      parts
    })
  }

  return entries
}

const PREVIEW_URL_TOOL_NAMES = new Set<string>([
  AgentToolsType.Bash,
  AgentToolsType.BashOutput,
  AgentToolsType.TaskOutput
])
const ANSI_ESCAPE_CHARACTER = String.fromCodePoint(27)
const LOCAL_PREVIEW_URL_PATTERN =
  /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/gi
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;:!?]+$/

export interface AgentPreviewUrlSource {
  createdAt: string | null
  messageId: string
  partIndex: number
}

export interface AgentPreviewUrlFrontier {
  createdAt: string | null
  messageId: string
  partsLength: number
}

export type AgentPreviewUrlCandidate = AgentPreviewUrlSource &
  ({ key: string; type: 'url'; url: string } | { key: string; type: 'deferred'; ref: DeferredToolResultRef })

function extractLatestLocalPreviewUrl(text: string): string | null {
  const matches = text.match(LOCAL_PREVIEW_URL_PATTERN)
  if (!matches?.length) return null

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const candidate = matches[index].split(ANSI_ESCAPE_CHARACTER, 1)[0].replace(TRAILING_URL_PUNCTUATION_PATTERN, '')
    try {
      const url = new URL(candidate)
      if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
      return url.toString()
    } catch {
      // Keep looking in case an earlier match in the same output is valid.
    }
  }
  return null
}

/** Extracts the last usable loopback URL from one resolved tool output. */
export function findAgentPreviewUrlInOutput(output: unknown): string | null {
  const text = textFromContent(output)
  return text ? extractLatestLocalPreviewUrl(text) : null
}

/** Builds newest-first candidates, stopping once an inline or excerpt URL makes older output irrelevant. */
export function findAgentPreviewUrlCandidates(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): AgentPreviewUrlCandidate[] {
  const candidates: AgentPreviewUrlCandidate[] = []
  const entries = getOrderedMessageParts(messages, partsByMessageId)

  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const { message, parts } = entries[entryIndex]
    const createdAt = getStableMessageCreatedAt(message)
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (!isToolUIPart(part) || !PREVIEW_URL_TOOL_NAMES.has(getToolName(part))) continue

      const output = getToolPartOutput(part)
      if (isDeferredToolOutput(output)) {
        const excerpt = output.excerpt
        const excerptUrl = excerpt ? findAgentPreviewUrlInOutput(`${excerpt.head}\n${excerpt.tail}`) : null
        if (excerptUrl) {
          candidates.push({
            createdAt,
            key: `url:${message.id}\0${partIndex}\0${excerptUrl}`,
            messageId: message.id,
            partIndex,
            type: 'url',
            url: excerptUrl
          })
          return candidates
        }
        const ref = output.$deferredToolResult
        candidates.push({
          createdAt,
          key: `deferred:${message.id}\0${partIndex}\0${ref.topicId}\0${ref.messageId}\0${ref.toolCallId}`,
          messageId: message.id,
          partIndex,
          type: 'deferred',
          ref
        })
        continue
      }

      const url = findAgentPreviewUrlInOutput(output)
      if (!url) continue
      candidates.push({
        createdAt,
        key: `url:${message.id}\0${partIndex}\0${url}`,
        messageId: message.id,
        partIndex,
        type: 'url',
        url
      })
      return candidates
    }
  }

  return candidates
}

/** Captures the current time frontier without materializing deferred outputs. */
export function getAgentPreviewUrlFrontier(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): AgentPreviewUrlFrontier | null {
  const entry = getOrderedMessageParts(messages, partsByMessageId).at(-1)
  return entry
    ? {
        createdAt: getStableMessageCreatedAt(entry.message),
        messageId: entry.message.id,
        partsLength: entry.parts.length
      }
    : null
}

/** Returns whether a source was appended after a previously captured time frontier. */
export function isAgentPreviewUrlSourceAfterFrontier(
  source: AgentPreviewUrlSource,
  frontier: AgentPreviewUrlFrontier | null,
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): boolean {
  if (!frontier) return true
  const entries = getOrderedMessageParts(messages, partsByMessageId)
  const frontierIndex = entries.findIndex(({ message }) => message.id === frontier.messageId)
  const sourceIndex = entries.findIndex(({ message }) => message.id === source.messageId)
  if (sourceIndex < 0) return false
  if (frontierIndex < 0) {
    if (!source.createdAt || !frontier.createdAt) return false
    const sourceTimestamp = Date.parse(source.createdAt)
    const frontierTimestamp = Date.parse(frontier.createdAt)
    if (!Number.isFinite(sourceTimestamp) || !Number.isFinite(frontierTimestamp)) return false
    if (sourceTimestamp !== frontierTimestamp) return sourceTimestamp > frontierTimestamp
    return source.messageId.localeCompare(frontier.messageId) > 0
  }
  if (sourceIndex !== frontierIndex) return sourceIndex > frontierIndex
  return source.partIndex >= frontier.partsLength
}

/** Finds a browser-ready URL only from concrete shell/task output, never from prompt text. */
export function findLatestAgentPreviewUrl(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): string | null {
  const candidate = findAgentPreviewUrlCandidates(messages, partsByMessageId)[0]
  return candidate?.type === 'url' ? candidate.url : null
}

function isTerminalToolState(state: string | undefined): boolean {
  return state === 'output-available' || state === 'output-error' || state === 'output-denied' || state === 'cancelled'
}

/**
 * Whether the call at `toolCallId` is a continuation receipt whose own id is not a flow root.
 *
 * Gated on the canonical tool name: an output that merely carries an agent id is not a receipt — a
 * DSH `subagent` launch reports one too. A call with content parented under it stays a root
 * regardless, because a cold-resumed DSH child streams under its own `send_message` call.
 */
export function isResumeReceiptCall(
  toolCallId: string,
  partsByMessageId: Record<string, CherryMessagePart[]> | null,
  lateTaskEvents?: AgentSessionTaskEvents
): boolean {
  if (!partsByMessageId) return false
  let isReceipt = false
  let hasChildren = false
  for (const parts of Object.values(partsByMessageId)) {
    for (const part of parts) {
      if (getPartParentToolCallId(part) === toolCallId) hasChildren = true
      const record = part as { toolCallId?: unknown; output?: unknown }
      if (record.toolCallId !== toolCallId) continue
      if (getCanonicalToolName(part) !== AgentToolsType.SendMessage) continue
      if (getResumedAgentId(record.output) !== undefined) isReceipt = true
    }
  }
  // A call the dsh runtime bound a task to streams under itself, so its receipt is the flow's root
  // rather than an edge to chase: paging history for a launch root would end in a dead click.
  if (getDshTaskRootCallIds(partsByMessageId, lateTaskEvents).has(toolCallId)) return false
  return isReceipt && !hasChildren
}

/**
 * Follow a tool-call entry to the flow it represents. A surface that binds a resumed task to the
 * SendMessage call id (e.g. a cold reconnect replaying resume edges) would otherwise open an empty
 * flow — everything streaming under the launch root instead.
 */
export function resolveFlowToolCallId(
  toolCallId: string,
  partsByMessageId: Record<string, CherryMessagePart[]> | null,
  lateTaskEvents?: AgentSessionTaskEvents
): { toolCallId: string; description?: string } | undefined {
  if (!partsByMessageId) return undefined
  // One index for the whole walk: it gates a stamped root to the loaded window — an absent root
  // would open an empty flow pane — and resolves the unstamped fallback the same way.
  const launchIndex = buildAgentLaunchIndex(partsByMessageId, lateTaskEvents)
  // A call the content streams under is a root in its own right — a cold-resumed dsh child streams
  // under its own send_message call — so redirecting it would move the content off its own root.
  if (launchIndex.dshTaskRootCallIds.has(toolCallId)) return undefined
  for (const parts of Object.values(partsByMessageId)) {
    if (parts.some((part) => getPartParentToolCallId(part) === toolCallId)) return undefined
  }
  for (const parts of Object.values(partsByMessageId)) {
    for (const part of parts) {
      const record = part as { toolCallId?: unknown; output?: unknown }
      if (typeof record.toolCallId !== 'string' || record.toolCallId !== toolCallId) continue
      // Opening a flow means this caller can navigate, so an unresolvable receipt must not resolve.
      const state = resolveResumeReceiptState(record.output, getPartLaunchToolCallId(part), launchIndex, true)
      return state.kind === 'navigable' ? { toolCallId: state.toolCallId, description: state.description } : undefined
    }
  }
  return undefined
}

/**
 * The agent id a launch receipt reports — the trailer string or a structured field. Prefers the
 * caller-resolved output so deferred (oversized) receipts still split resume rounds correctly.
 */
function extractLaunchedAgentId(part: CherryMessagePart | undefined, resolvedOutput?: unknown): string | undefined {
  const output = resolvedOutput !== undefined ? resolvedOutput : part && (part as { output?: unknown }).output
  // Single launch-receipt grammar everywhere: the shared parser handles text markers and the
  // structured spellings, so round splitting and entry redirection can never disagree.
  const launchedAgentId = extractLaunchReceiptId(output)
  if (launchedAgentId) return launchedAgentId
  // A cold-resumed child streams under its own resume receipt, so that receipt — not a launch —
  // is the flow's root and names the agent the flow belongs to.
  if (part && getCanonicalToolName(part) === AgentToolsType.SendMessage) return getReceiptTarget(part, output)
  return undefined
}

/**
 * The child a SendMessage receipt targets. The result names it when it was delivered inline; an
 * oversized (deferred) result hides it, and then the call's own `to` — or dsh's `agent_id` — is the
 * only correlation, which is also what lets a deferred round still show the request it carried.
 */
function getReceiptTarget(part: CherryMessagePart, output: unknown): string | undefined {
  const resumedAgentId = getResumedAgentId(output)
  if (resumedAgentId) return resumedAgentId
  const input = (part as { input?: { to?: unknown; agent_id?: unknown; subagent_id?: unknown } }).input
  for (const candidate of [input?.to, input?.agent_id, input?.subagent_id]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return undefined
}

/** Whether this part is a SendMessage receipt that resumed THIS agent — the round boundary. */
function isResumeReceiptFor(part: CherryMessagePart, launchedAgentId: string): boolean {
  // A persisted static part carries the name in its type (`tool-SendMessage`), so the canonical
  // reader decides; the wire name alone would miss every settled history row.
  if (getCanonicalToolName(part) !== AgentToolsType.SendMessage) return false
  return getReceiptTarget(part, (part as { output?: unknown }).output) === launchedAgentId
}

/** Calls the dsh runtime bound a task to, from the loaded parts and the live task-event cache. */
export function getDshTaskRootCallIds(
  partsByMessageId: Record<string, CherryMessagePart[]> | null,
  lateTaskEvents?: AgentSessionTaskEvents
): ReadonlySet<string> {
  return buildAgentLaunchIndex(partsByMessageId, lateTaskEvents).dshTaskRootCallIds
}

/** Whether a task event describes an agent run — the only kind of task a resume receipt can target. */
function isAgentTaskEvent(data: AgentTaskEventPartData): boolean {
  return (
    data.taskType === 'subagent' ||
    data.taskType === 'local_agent' ||
    data.taskType === 'local_workflow' ||
    data.subagentType !== undefined
  )
}

/** The request to show between rounds — the sent message, falling back to its summary. */
function getResumeReceiptPromptText(part: CherryMessagePart): string | undefined {
  const input = (part as { input?: unknown }).input
  if (!isRecord(input)) return undefined
  // A blank message must not mask a non-empty summary as the round prompt.
  const message = typeof input.message === 'string' && input.message.trim() ? input.message : undefined
  const prompt = message ?? input.summary
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : undefined
}

export function buildAgentToolFlowProjection(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  selectedToolCallId?: string,
  resolvedSelectedOutput?: unknown
): AgentToolFlowProjection {
  const toolNodes: AgentToolFlowNode[] = []
  const childrenByParent = new Map<string, string[]>()
  const toolPartByCallId = new Map<string, CherryMessagePart>()
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const messageEntries = getOrderedMessageParts(messages, partsByMessageId)

  for (const { message, parts } of messageEntries) {
    messageById.set(message.id, message)
    parts.forEach((part, partIndex) => {
      if (!isToolUIPart(part)) return
      const toolCallId = getToolCallId(part)
      if (!toolCallId) return

      const parentToolCallId = getPartParentToolCallId(part)
      const input = getToolPartInput(part)
      const title = isRecord(input)
        ? [input.description, input.subject, input.title, input.name].find(
            (value) => typeof value === 'string' && value.trim()
          )
        : undefined
      const node: AgentToolFlowNode = {
        ...(typeof title === 'string' ? { title: title.trim() } : {}),
        toolCallId,
        toolName: getToolNameFromPart(part) ?? toolCallId,
        parentToolCallId,
        messageId: message.id,
        partIndex,
        state: getToolPartState(part)
      }
      toolNodes.push(node)
      toolPartByCallId.set(toolCallId, part)
      if (parentToolCallId) {
        const children = childrenByParent.get(parentToolCallId) ?? []
        children.push(toolCallId)
        childrenByParent.set(parentToolCallId, children)
      }
    })
  }

  const selectedToolCallIds = new Set<string>()
  if (selectedToolCallId) {
    selectedToolCallIds.add(selectedToolCallId)
    const stack = [...(childrenByParent.get(selectedToolCallId) ?? [])]
    while (stack.length) {
      const toolCallId = stack.pop()
      if (!toolCallId || selectedToolCallIds.has(toolCallId)) continue
      selectedToolCallIds.add(toolCallId)
      stack.push(...(childrenByParent.get(toolCallId) ?? []))
    }
  }

  const flowMessages: CherryUIMessage[] = []
  const flowPartsByMessageId: Record<string, CherryMessagePart[]> = {}

  if (selectedToolCallIds.size) {
    const selectedTool = toolNodes.find((node) => node.toolCallId === selectedToolCallId)
    const selectedToolPart = selectedToolCallId ? toolPartByCallId.get(selectedToolCallId) : undefined
    const selectedMessage = selectedTool ? messageById.get(selectedTool.messageId) : undefined
    const selectedCreatedAt = getMessageCreatedAt(selectedMessage)
    const promptMessage = createFlowTextMessage(
      `${selectedToolCallId}:agent-flow-prompt`,
      'user',
      getToolPromptText(selectedToolPart),
      selectedCreatedAt
    )
    if (promptMessage) {
      flowMessages.push(promptMessage)
      flowPartsByMessageId[promptMessage.id] = promptMessage.parts
    }

    // A flow keeps only the task events of its own children: their linkage lives inside `data`
    // (`taskId`/`toolUseId`), which the walk below cannot reach through tool-call metadata.
    const taskIds = new Set<string>()
    // The task bound to this root names the child even when the launch result is the child's own
    // answer rather than a receipt — a foreground run reports no agent id anywhere else.
    let rootTaskId: string | undefined
    for (const { parts } of messageEntries) {
      for (const part of parts) {
        if (part.type !== 'data-agent-task-event' || !part.data.toolUseId) continue
        if (part.data.toolUseId === selectedToolCallId) {
          // Only an agent task names a child a receipt can resume; a shell or monitor task id is
          // never a SendMessage target, so it must not become this flow's identity.
          if (isAgentTaskEvent(part.data)) rootTaskId ??= part.data.taskId
        } else if (selectedToolCallIds.has(part.data.toolUseId)) taskIds.add(part.data.taskId)
      }
    }

    // Content is segmented by the resume requests that continued this agent: each SendMessage
    // receipt resolving to the launch splits the timeline, so its prompt lands between rounds.
    // The launch receipt's own result text is NOT appended — it duplicates the agent's final
    // message already present above and goes stale across continuations.
    // A launch whose result is the child's answer (a foreground run) names no agent id, so the
    // child is read from the task the runtime bound to this root — the same id a resume receipt
    // targets.
    const launchedAgentId = extractLaunchedAgentId(selectedToolPart, resolvedSelectedOutput) ?? rootTaskId
    const isFlowActive = toolNodes.some(
      (node) => selectedToolCallIds.has(node.toolCallId) && !isTerminalToolState(node.state)
    )

    // Content is split into rounds two ways: runtime-tagged parts (`cherry.resumedViaCallId`,
    // authoritative and restart-safe — the host row usually predates the receipt row, so position
    // alone cannot order them), or — for untagged history — the receipt's own walk position.
    const receiptPrompts = new Map<string, string>()
    const probeReceipts: Array<Record<string, unknown>> = []
    // Markers belonging to sibling agents' continuations must not split this flow, so the set of
    // this agent's own receipt call ids gates every marker-driven split.
    const ownReceiptCallIds = new Set<string>()
    if (launchedAgentId) {
      for (const { parts } of messageEntries) {
        for (const part of parts) {
          const toolCallId = getToolCallId(part)
          // The flow's own root never opens a round of its own flow: a receipt root already reads
          // as the flow prompt, so registering it here would repeat that prompt between rounds.
          if (!toolCallId || toolCallId === selectedToolCallId || receiptPrompts.has(toolCallId)) continue
          if (!isToolUIPart(part) || getCanonicalToolName(part) !== AgentToolsType.SendMessage) continue
          if (!isResumeReceiptFor(part, launchedAgentId)) continue
          ownReceiptCallIds.add(toolCallId)
          const prompt = getResumeReceiptPromptText(part)
          if (prompt) receiptPrompts.set(toolCallId, prompt)
          probeReceipts.push({
            toolCallId,
            prompt: Boolean(prompt),
            inputKeys: Object.keys((part as { input?: object }).input ?? {})
          })
        }
      }
    }

    const segments: Array<{ parts: CherryMessagePart[] }> = [{ parts: [] }]
    // The result text only fills a flow that has no streamed child parts at all (a runtime whose
    // foreground calls emit no detachable content); Claude Code streams them even for foreground
    // runs, so injecting there would duplicate the report and leak its agentId trailer. Background
    // launch receipts are control metadata and must never surface; an unresolved deferred envelope
    // has no text to show yet.
    const hasDetachedFlow = messageEntries.some(({ parts }) =>
      parts.some((part) => getPartParentToolCallId(part) === selectedToolCallId)
    )
    if (!hasDetachedFlow) {
      const selectedOutput =
        resolvedSelectedOutput !== undefined
          ? resolvedSelectedOutput
          : selectedToolPart
            ? getToolPartOutput(selectedToolPart)
            : undefined
      const selectedOutputText =
        isRecord(selectedOutput) && '$deferredToolResult' in selectedOutput
          ? undefined
          : textFromContent(selectedOutput)
      // A receipt's own text is delivery metadata, never the child's answer. Only the receipt is
      // suppressed: a root whose result is the resumed run's answer keeps it.
      const foregroundResultText =
        getResumedAgentId(selectedOutput) !== undefined ||
        isBackgroundAgentLaunchReceipt(selectedOutput, selectedOutputText)
          ? undefined
          : selectedOutputText
      if (foregroundResultText) {
        segments[0].parts.push({ type: 'text', text: foregroundResultText })
      }
    }
    let segmentIndex = 0
    let emittedSegments = 0
    let resumeCount = 0
    const consumedMarkers = new Set<string>()
    const probeBoundaries: Array<Record<string, unknown>> = []
    const emitSegment = (index: number) => {
      const segment = segments[index]
      if (segment.parts.length === 0 && !isFlowActive) return
      const id = `${selectedToolCallId}:agent-flow-assistant${index === 0 ? '' : `-${index}`}`
      const assistantMessage = {
        id,
        role: 'assistant',
        parts: segment.parts,
        metadata: {
          createdAt: selectedCreatedAt,
          status: isFlowActive ? 'pending' : 'success'
        }
      } as CherryUIMessage
      flowMessages.push(assistantMessage)
      flowPartsByMessageId[id] = segment.parts
    }
    for (const { message, parts } of messageEntries) {
      for (const part of parts) {
        // Task events carry no tool-call metadata, so they join the round they fall in and never
        // reach the resume-marker walk below.
        if (part.type === 'data-agent-task-event') {
          if (taskIds.has(part.data.taskId)) segments[segmentIndex].parts.push(part)
          continue
        }
        const toolCallId = getToolCallId(part)

        // Runtime-tagged round boundary: the first marked part opens the new round. The matching
        // receipt's prompt text (pre-scanned by call id) backfills the user message; when that
        // receipt is walked later it must not split a second time. The adapter only stamps parts
        // whose parent is this launch root, but sibling flows sharing the walk order need the
        // receipt-set check too, so both gates guard against splitting on foreign markers.
        const marker = getPartResumeMarker(part)

        // A resume receipt is not itself part of the flow, but for untagged content it marks where
        // a new round starts. Skip if its call id was already consumed by a runtime marker.
        const isResumeReceipt =
          launchedAgentId &&
          isToolUIPart(part) &&
          toolCallId !== selectedToolCallId &&
          isResumeReceiptFor(part, launchedAgentId) &&
          !(toolCallId && consumedMarkers.has(toolCallId))

        // A marker only opens a round when its receipt was matched and carried a request: a break
        // whose prompt is unknown reads as an empty round, so that content stays in this one.
        const markerOwnsThisFlow =
          marker !== undefined &&
          receiptPrompts.has(marker) &&
          marker !== selectedToolCallId &&
          !consumedMarkers.has(marker) &&
          (ownReceiptCallIds.has(marker) || getPartParentToolCallId(part) === selectedToolCallId)

        probeBoundaries.push({
          messageId: message.id,
          toolCallId: toolCallId ?? null,
          marker: marker ?? null,
          isResumeReceipt: Boolean(isResumeReceipt),
          markerOwnsThisFlow
        })
        if (markerOwnsThisFlow || isResumeReceipt) {
          // The receipt's own request wins when it is the part being walked; a marker-split reads
          // the request of the receipt that opened the round.
          const promptText = isResumeReceipt ? getResumeReceiptPromptText(part) : receiptPrompts.get(marker ?? '')
          if (promptText) {
            for (; emittedSegments <= segmentIndex; emittedSegments += 1) emitSegment(emittedSegments)
            resumeCount += 1
            if (marker) consumedMarkers.add(marker)
            // A part that is both consumes both ids: the receipt's call id must not split again, or
            // a same-message tagged part would duplicate the prompt message.
            if (isResumeReceipt && toolCallId) consumedMarkers.add(toolCallId)
            segmentIndex += 1
            segments.push({ parts: [] })
            const resumeMessage = createFlowTextMessage(
              `${selectedToolCallId}:agent-flow-resume-${resumeCount}`,
              'user',
              promptText,
              selectedCreatedAt
            )
            if (resumeMessage) {
              flowMessages.push(resumeMessage)
              flowPartsByMessageId[resumeMessage.id] = resumeMessage.parts
            }
          }
          if (isResumeReceipt) continue
          // A tagged part belongs to the new round — fall through to descendant inclusion.
        }

        // A receipt whose round was already opened by a marker is a boundary, not content: without
        // this it would fall through and be pushed into the segment as an ordinary tool part.
        if (toolCallId && consumedMarkers.has(toolCallId)) continue

        if (toolCallId) {
          if (toolCallId === selectedToolCallId || !selectedToolCallIds.has(toolCallId)) continue
        } else {
          const parentToolCallId = getPartParentToolCallId(part)
          if (!parentToolCallId || !selectedToolCallIds.has(parentToolCallId)) continue
        }

        segments[segmentIndex].parts.push(getPartWithoutParentMetadata(part))
      }
    }
    for (; emittedSegments < segments.length; emittedSegments += 1) emitSegment(emittedSegments)
    if (probeBoundaries.length > 1)
      probeLogger.info('projection', {
        selectedToolCallId,
        launchedAgentId,
        rootTaskId,
        messageOrder: messageEntries.map(({ message }) => message.id),
        receipts: probeReceipts,
        ownReceiptCallIds: [...ownReceiptCallIds],
        boundaries: probeBoundaries,
        flowOrder: flowMessages.map((item) => `${item.role}:${item.id}`)
      })
  }

  return {
    selectedTool: selectedToolCallId ? toolNodes.find((node) => node.toolCallId === selectedToolCallId) : undefined,
    toolNodes,
    selectedToolCallIds,
    messages: flowMessages,
    partsByMessageId: flowPartsByMessageId
  }
}
