import {
  getTaskActiveText,
  getTaskId,
  getTaskTitle,
  isTaskRecord,
  normalizeTaskStatus
} from '@renderer/components/chat/messages/tools/agent'
import {
  type AgentToolOutput,
  AgentToolsType,
  extractLaunchReceiptId,
  getResumedAgentId,
  isBackgroundAgentOutput,
  resolveResumedAgent
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import {
  getPartLaunchToolCallId,
  getPartParentToolCallId,
  getPartResumeMarker,
  hasPartParentToolCallId,
  stripPartParentToolMetadata
} from '@renderer/components/chat/messages/tools/toolParentMetadata'
import { getCanonicalToolName } from '@renderer/components/chat/messages/tools/toolResponse'
import type { AgentSessionTaskEvents } from '@shared/ai/agentSessionBackgroundTasks'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import { getToolName, isDataUIPart, isToolUIPart } from 'ai'

export type AgentRightPaneTab = 'files' | 'status' | `flow:${string}`

export interface AgentToolFlowOpenInput {
  toolCallId: string
  toolName?: string
  title?: string
}

export interface AgentToolFlowNode {
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
export interface AgentStatusTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  activeText?: string
}

/**
 * A process the run spawned — a subagent, shell or workflow — reported through the SDK's task
 * lifecycle events. It either runs or it settles; a done/total ratio over these would be
 * meaningless, which is why they are kept apart from the plan above.
 */
export interface AgentRunTask {
  id: string
  toolUseId?: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'stopped' | 'error'
  activeText?: string
  /** SDK task type, e.g. 'subagent' | 'shell' | 'local_workflow'. */
  taskType?: string
  subagentType?: string
  workflowName?: string
  summary?: string
  lastToolName?: string
  outputFile?: string
  usage?: AgentTaskEventPartData['usage']
}

/** A final deliverable file the agent declared via the `report_artifacts` tool. */
export interface AgentArtifactFile {
  toolCallId: string
  path: string
  name: string
  description?: string
}

/**
 * Ground truth for "is this run task actually still running". A row's own events cannot answer it:
 * an interrupted turn, a crash or an app restart leaves the last event at `in_progress` forever.
 */
export interface AgentRunLiveness {
  /** Assistant message ids whose own turn is still pending. */
  activeMessageIds: ReadonlySet<string>
  /** Task ids currently present in the runtime's background-task membership snapshot. */
  liveBackgroundTaskIds: ReadonlySet<string>
}

export interface AgentRightPaneStatus {
  tasks: AgentStatusTask[]
  completedTaskCount: number
  totalTaskCount: number
  runTasks: AgentRunTask[]
  artifacts: AgentArtifactFile[]
}

const strippedParentMetadataCache = new WeakMap<object, CherryMessagePart>()

function getPartWithoutParentMetadata(part: CherryMessagePart): CherryMessagePart {
  if (typeof part !== 'object' || part === null) return stripPartParentToolMetadata(part)
  const cached = strippedParentMetadataCache.get(part)
  if (cached) return cached
  const stripped = stripPartParentToolMetadata(part)
  strippedParentMetadataCache.set(part, stripped)
  return stripped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getToolCallId(part: CherryMessagePart): string | undefined {
  const toolCallId = (part as unknown as { toolCallId?: unknown }).toolCallId
  return typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined
}

function getToolPartState(part: CherryMessagePart): string | undefined {
  const state = (part as unknown as { state?: unknown }).state
  return typeof state === 'string' ? state : undefined
}

function getToolPartInput(part: CherryMessagePart): unknown {
  return (part as unknown as { input?: unknown }).input
}

function getToolPartOutput(part: CherryMessagePart): unknown {
  const output = (part as unknown as { output?: unknown }).output
  if (isRecord(output) && 'content' in output) return output.content
  return output
}

function getToolNameFromPart(part: CherryMessagePart): string | undefined {
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
  } as CherryUIMessage
}

function getMessageCreatedAt(message: CherryUIMessage | undefined): string {
  const createdAt = (message as unknown as { createdAt?: unknown } | undefined)?.createdAt
  return message?.metadata?.createdAt ?? (typeof createdAt === 'string' ? createdAt : new Date(0).toISOString())
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
      } as CherryUIMessage,
      parts
    })
  }

  return entries
}

function isTerminalToolState(state: string | undefined): boolean {
  return state === 'output-available' || state === 'output-error' || state === 'output-denied' || state === 'cancelled'
}

/**
 * Follow a tool-call entry to the flow it represents. A surface that binds a resumed task to the
 * SendMessage call id (e.g. a cold reconnect replaying resume edges) would otherwise open an empty
 * flow — everything streaming under the launch root instead.
 */
export function resolveFlowToolCallId(
  toolCallId: string,
  partsByMessageId: Record<string, CherryMessagePart[]> | null
): { toolCallId: string; description?: string } | undefined {
  if (!partsByMessageId) return undefined
  for (const parts of Object.values(partsByMessageId)) {
    for (const part of parts) {
      const record = part as { toolCallId?: unknown; output?: unknown }
      if (typeof record.toolCallId !== 'string' || record.toolCallId !== toolCallId) continue
      // The adapter-stamped launch root resolves even when the launch row itself has been paged
      // out; the scan below stays as the fallback for unstamped history.
      const stamped = getPartLaunchToolCallId(part)
      if (stamped) {
        const description = resolveResumedAgent(record.output, partsByMessageId)?.description
        return description ? { toolCallId: stamped, description } : { toolCallId: stamped }
      }
      // Receipt outputs are small inline JSON, so no deferred-envelope resolution is needed here
      // (unlike launch receipts, whose resolved output the flow view prefers).
      return resolveResumedAgent(record.output, partsByMessageId)
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
  // Single launch-receipt grammar everywhere: the shared parser gates on the structural markers
  // and extracts the trailer, so round splitting and entry redirection can never disagree.
  if (typeof output === 'string') return extractLaunchReceiptId(output)
  if (isRecord(output)) {
    // Workflow/local launches carry the same identity under `taskId`.
    const direct = output.agentId ?? output.agent_id ?? output.taskId
    return typeof direct === 'string' && direct.length > 0 ? direct : undefined
  }
  return undefined
}

/** Whether this part is a SendMessage receipt that resumed THIS agent — the round boundary. */
function isResumeReceiptFor(part: CherryMessagePart, launchedAgentId: string): boolean {
  const record = part as { toolName?: unknown; output?: unknown }
  return record.toolName === AgentToolsType.SendMessage && getResumedAgentId(record.output) === launchedAgentId
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
      const node: AgentToolFlowNode = {
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
      flowPartsByMessageId[promptMessage.id] = promptMessage.parts as CherryMessagePart[]
    }

    // Content is segmented by the resume requests that continued this agent: each SendMessage
    // receipt resolving to the launch splits the timeline, so its prompt lands between rounds.
    // The launch receipt's own result text is NOT appended — it duplicates the agent's final
    // message already present above and goes stale across continuations.
    const launchedAgentId = extractLaunchedAgentId(selectedToolPart, resolvedSelectedOutput)
    const isFlowActive = toolNodes.some(
      (node) => selectedToolCallIds.has(node.toolCallId) && !isTerminalToolState(node.state)
    )

    // Content is split into rounds two ways: runtime-tagged parts (`cherry.resumedViaCallId`,
    // authoritative and restart-safe — the host row usually predates the receipt row, so position
    // alone cannot order them), or — for untagged history — the receipt's own walk position.
    const receiptPrompts = new Map<string, string>()
    // Markers belonging to sibling agents' continuations must not split this flow, so the set of
    // this agent's own receipt call ids gates every marker-driven split.
    const ownReceiptCallIds = new Set<string>()
    if (launchedAgentId) {
      for (const { parts } of messageEntries) {
        for (const part of parts) {
          const toolCallId = getToolCallId(part)
          if (!toolCallId || receiptPrompts.has(toolCallId)) continue
          if (!isToolUIPart(part) || getToolNameFromPart(part) !== AgentToolsType.SendMessage) continue
          if (!isResumeReceiptFor(part, launchedAgentId)) continue
          ownReceiptCallIds.add(toolCallId)
          const prompt = getResumeReceiptPromptText(part)
          if (prompt) receiptPrompts.set(toolCallId, prompt)
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
      const foregroundResultText = isBackgroundAgentLaunchReceipt(selectedOutput, selectedOutputText)
        ? undefined
        : selectedOutputText
      if (foregroundResultText) {
        segments[0].parts.push({ type: 'text', text: foregroundResultText } as CherryMessagePart)
      }
    }
    let segmentIndex = 0
    let emittedSegments = 0
    let resumeCount = 0
    const consumedMarkers = new Set<string>()
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
    for (const { parts } of messageEntries) {
      for (const part of parts) {
        const toolCallId = getToolCallId(part)

        // Runtime-tagged round boundary: the first marked part opens the new round. The matching
        // receipt's prompt text (pre-scanned by call id) backfills the user message; when that
        // receipt is walked later it must not split a second time. The adapter only stamps parts
        // whose parent is this launch root, but sibling flows sharing the walk order need the
        // receipt-set check too, so both gates guard against splitting on foreign markers.
        const marker = launchedAgentId ? getPartResumeMarker(part) : undefined

        // A resume receipt is not itself part of the flow, but for untagged content it marks where
        // a new round starts. Skip if its call id was already consumed by a runtime marker.
        const isResumeReceipt =
          launchedAgentId &&
          isToolUIPart(part) &&
          isResumeReceiptFor(part, launchedAgentId) &&
          !(toolCallId && consumedMarkers.has(toolCallId))

        const markerOwnsThisFlow =
          marker !== undefined &&
          !consumedMarkers.has(marker) &&
          (ownReceiptCallIds.has(marker) || getPartParentToolCallId(part) === selectedToolCallId)

        if (markerOwnsThisFlow || isResumeReceipt) {
          for (; emittedSegments <= segmentIndex; emittedSegments += 1) emitSegment(emittedSegments)
          resumeCount += 1
          if (marker) consumedMarkers.add(marker)
          // A position-based split must also consume the receipt's call id, or a same-message
          // tagged part would split a second time and duplicate the prompt message.
          else if (isResumeReceipt && toolCallId) consumedMarkers.add(toolCallId)
          segmentIndex += 1
          segments.push({ parts: [] })
          const promptText = marker !== undefined ? receiptPrompts.get(marker) : getResumeReceiptPromptText(part)
          const resumeMessage = createFlowTextMessage(
            `${selectedToolCallId}:agent-flow-resume-${resumeCount}`,
            'user',
            promptText,
            selectedCreatedAt
          )
          if (resumeMessage) {
            flowMessages.push(resumeMessage)
            flowPartsByMessageId[resumeMessage.id] = resumeMessage.parts as CherryMessagePart[]
          }
          if (isResumeReceipt) continue
          // A tagged part belongs to the new round — fall through to descendant inclusion.
        }

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
  }

  return {
    selectedTool: selectedToolCallId ? toolNodes.find((node) => node.toolCallId === selectedToolCallId) : undefined,
    toolNodes,
    selectedToolCallIds,
    messages: flowMessages,
    partsByMessageId: flowPartsByMessageId
  }
}

interface TaskPlanProjectionState {
  tasks: Map<string, AgentStatusTask>
  /** Undefined until a TaskCreate is observed, preserving TaskList-only history. */
  currentPlanTaskIds?: Set<string>
}

function applyTaskToolPart(
  state: TaskPlanProjectionState,
  part: CherryMessagePart,
  fallbackId: string,
  toolName: string | undefined
): boolean {
  const taskMap = state.tasks
  const input = getToolPartInput(part)
  const output = getToolPartOutput(part)

  if (toolName === AgentToolsType.TaskCreate) {
    const currentPlanCompleted =
      taskMap.size > 0 && Array.from(taskMap.values()).every((task) => task.status === 'completed')
    if (currentPlanCompleted) {
      taskMap.clear()
      state.currentPlanTaskIds = new Set()
    } else if (taskMap.size === 0 && !state.currentPlanTaskIds) {
      state.currentPlanTaskIds = new Set()
    }

    const inputRecord = isTaskRecord(input) ? input : {}
    const outputRecord = isTaskRecord(output) ? output : {}
    const outputTask = isTaskRecord(outputRecord.task) ? outputRecord.task : undefined
    const outputTextId =
      typeof output === 'string' ? output.match(/^Task #(\S+) created successfully:/)?.[1] : undefined
    const id =
      (outputTask ? getTaskId(outputTask) : undefined) ?? outputTextId ?? getNextTaskOrdinalId(taskMap) ?? fallbackId
    const title = (outputTask ? getTaskTitle(outputTask) : undefined) ?? getTaskTitle(inputRecord, id) ?? id
    const activeText = getTaskActiveText(inputRecord)
    taskMap.set(id, { id, title, activeText, status: 'pending' })
    state.currentPlanTaskIds?.add(id)
    return true
  }

  if (toolName === AgentToolsType.TaskUpdate) {
    const inputRecord = isTaskRecord(input) ? input : {}
    const id = getTaskId(inputRecord) ?? (isTaskRecord(output) ? getTaskId(output) : undefined) ?? fallbackId
    const existing = taskMap.get(id)
    const status = normalizeTaskStatus(inputRecord.status)
    taskMap.set(id, {
      id,
      title: getTaskTitle(inputRecord, existing?.title ?? id) ?? existing?.title ?? id,
      activeText: getTaskActiveText(inputRecord) ?? existing?.activeText,
      status: status ?? existing?.status ?? 'pending'
    })
    return true
  }

  if (toolName === AgentToolsType.TaskList) {
    const tasks = isTaskRecord(output) && Array.isArray(output.tasks) ? output.tasks : []
    for (const task of tasks) {
      if (!isTaskRecord(task)) continue
      const id = getTaskId(task)
      const title = getTaskTitle(task, id)
      if (!id || !title) continue
      if (state.currentPlanTaskIds && !state.currentPlanTaskIds.has(id)) continue
      taskMap.set(id, {
        id,
        title,
        status: normalizeTaskStatus(task.status) ?? 'pending'
      })
    }
    return true
  }

  return false
}

function getNextTaskOrdinalId(taskMap: Map<string, AgentStatusTask>): string | undefined {
  for (let index = 1; index <= taskMap.size + 1; index += 1) {
    const id = String(index)
    if (!taskMap.has(id)) return id
  }
  return undefined
}

// Keyed on the canonical TodoWrite identity: every runtime's native todo tool normalizes onto
// it through the transport-tagged tool-name mapping, so no runtime is special-cased here.
function getTodoSnapshot(part: CherryMessagePart): AgentStatusTask[] | undefined {
  if (getCanonicalToolName(part) !== AgentToolsType.TodoWrite || getToolPartState(part) !== 'output-available') {
    return undefined
  }

  const input = getToolPartInput(part)
  if (!isRecord(input) || !Array.isArray(input.todos)) return undefined

  return input.todos.flatMap((todo, index) => {
    if (!isRecord(todo) || typeof todo.content !== 'string') return []
    const title = todo.content.trim()
    if (!title) return []

    return [
      {
        id: `todo:${index}:${title}`,
        title,
        status: (typeof todo.status === 'string' ? normalizeTaskStatus(todo.status) : undefined) ?? 'pending'
      }
    ]
  })
}

const RUN_TASK_TERMINAL_STATUSES = new Set<AgentRunTask['status']>(['completed', 'stopped', 'error'])

function applyAgentTaskEvent(
  runTaskMap: Map<string, AgentRunTask>,
  data: AgentTaskEventPartData,
  originMessageId?: string,
  originMessageIds?: Map<string, string>
): void {
  const existing = runTaskMap.get(data.taskId)
  // A completion's summary is prose, not a name — it must never become the row title.
  const title = existing?.title || data.title?.trim() || data.description?.trim()
  if (!title) return

  // Events reach this map from two orderings (message parts, then the late-event cache), so a stale
  // pre-completion event can apply after the completion did. A settled task never resurrects.
  const incoming = data.status ?? existing?.status ?? 'pending'
  const status =
    existing && RUN_TASK_TERMINAL_STATUSES.has(existing.status) && !RUN_TASK_TERMINAL_STATUSES.has(incoming)
      ? existing.status
      : incoming

  runTaskMap.set(data.taskId, {
    id: data.taskId,
    // First registration wins: SendMessage-resume edges carry the resuming call's id while
    // content keeps streaming under the original launch tool-use id.
    toolUseId: existing?.toolUseId ?? data.toolUseId,
    title,
    activeText: data.activeText ?? data.description ?? existing?.activeText,
    status,
    taskType: data.taskType ?? existing?.taskType,
    subagentType: data.subagentType ?? existing?.subagentType,
    workflowName: data.workflowName ?? existing?.workflowName,
    summary: data.summary ?? existing?.summary,
    lastToolName: data.lastToolName ?? existing?.lastToolName,
    outputFile: data.outputFile ?? existing?.outputFile,
    usage: data.usage ?? existing?.usage
  })
  if (originMessageId && !originMessageIds?.has(data.taskId)) {
    originMessageIds?.set(data.taskId, originMessageId)
  }
}

function isReportArtifactsTool(toolName: string | undefined): boolean {
  return toolName === REPORT_ARTIFACTS_TOOL_NAME || (toolName?.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`) ?? false)
}

function getPathBasename(path: string): string {
  const segments = path
    .trim()
    .split(/[/\\]+/)
    .filter(Boolean)
  return segments.at(-1) ?? path
}

export function buildAgentRightPaneStatus(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  /**
   * Latest per-task lifecycle edge for the current CLI process. Applied last by task id so a
   * background task's completion settles the row the transcript parts built.
   */
  lateTaskEvents: AgentSessionTaskEvents = {},
  /** Omitted means "trust the events" — production always passes it. */
  liveness?: AgentRunLiveness
): AgentRightPaneStatus {
  const taskPlanState: TaskPlanProjectionState = { tasks: new Map() }
  const taskMap = taskPlanState.tasks
  let todoSnapshotTasks: AgentStatusTask[] | undefined
  const runTaskMap = new Map<string, AgentRunTask>()
  const runTaskOriginMessageIds = new Map<string, string>()
  const artifactByPath = new Map<string, AgentArtifactFile>()

  for (const message of messages) {
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    parts.forEach((part, partIndex) => {
      if (isDataUIPart(part) && part.type === 'data-agent-task-event') {
        applyAgentTaskEvent(runTaskMap, part.data, message.id, runTaskOriginMessageIds)
      }

      if (!isToolUIPart(part)) return
      const toolName = getToolNameFromPart(part)
      const fallbackId = getToolCallId(part) ?? `${message.id}-${partIndex}`
      // The plan has two writers — the incremental task ledger and full-list todo snapshots —
      // and the most recent writer owns it: a later ledger write invalidates an earlier snapshot.
      // Both writers are main-agent-only: spawned-run parts are parented under their Task call.
      if (!hasPartParentToolCallId(part)) {
        if (applyTaskToolPart(taskPlanState, part, fallbackId, toolName)) todoSnapshotTasks = undefined
        const todoSnapshot = getTodoSnapshot(part)
        if (todoSnapshot !== undefined) todoSnapshotTasks = todoSnapshot
      }

      if (isReportArtifactsTool(toolName)) {
        const parsed = reportArtifactsInputSchema.safeParse(getToolPartInput(part))
        if (parsed.success) {
          for (const artifact of parsed.data.artifacts) {
            const path = artifact.path.trim()
            if (!path) continue
            artifactByPath.set(path, {
              toolCallId: fallbackId,
              path,
              name: getPathBasename(path),
              description: artifact.description
            })
          }
        }
      }
    })
  }

  for (const data of Object.values(lateTaskEvents)) {
    applyAgentTaskEvent(runTaskMap, data)
  }

  // A run only settles if its completion event arrives; an interrupted turn, a crashed CLI or an
  // app restart means it never will. Foreground liveness belongs to the originating assistant row,
  // while background liveness comes only from the runtime's current background-task membership snapshot.
  if (liveness) {
    for (const [id, task] of runTaskMap) {
      if (RUN_TASK_TERMINAL_STATUSES.has(task.status)) continue
      const originMessageId = runTaskOriginMessageIds.get(id)
      if (
        (originMessageId && liveness.activeMessageIds.has(originMessageId)) ||
        liveness.liveBackgroundTaskIds.has(id)
      ) {
        continue
      }
      runTaskMap.set(id, { ...task, status: 'pending', activeText: undefined })
    }
  }

  // The SDK's task tools share one id space with spawned runs, so `TaskList` output can echo a
  // running subagent back into the plan. The runs section owns those ids; keep the plan to items
  // that are only ever plan.
  for (const id of runTaskMap.keys()) {
    taskMap.delete(id)
  }

  const tasks = todoSnapshotTasks ?? Array.from(taskMap.values())
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length

  return {
    tasks,
    completedTaskCount,
    totalTaskCount: tasks.length,
    runTasks: Array.from(runTaskMap.values()),
    artifacts: Array.from(artifactByPath.values())
  }
}
