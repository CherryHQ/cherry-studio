import { isDataUIPart, isToolUIPart } from 'ai'

import {
  getTaskActiveText,
  getTaskId,
  getTaskTitle,
  isTaskRecord,
  normalizeTaskStatus
} from '@renderer/components/chat/messages/tools/agent'
import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { hasPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import { getCanonicalToolName } from '@renderer/components/chat/messages/tools/toolResponse'
import type { AgentSessionTaskEvents } from '@shared/ai/agentSessionBackgroundTasks'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import {
  getDshTaskRootCallIds,
  getToolCallId,
  getToolNameFromPart,
  getToolPartInput,
  getToolPartOutput,
  getToolPartState,
  isRecord
} from './agentRightPaneProjection'

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
  dshTaskRootCallIds: ReadonlySet<string>,
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
    // content keeps streaming under the original launch tool-use id — except for a dsh task the
    // runtime rebound to its resume call, which is where that child's content now streams.
    toolUseId:
      data.toolUseId && dshTaskRootCallIds.has(data.toolUseId)
        ? data.toolUseId
        : (existing?.toolUseId ?? data.toolUseId),
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
  // A dsh task rebound to its resume call must follow that call, even when the launch's own task
  // event is loaded and would otherwise win the row; the edge may live only in the live cache.
  const dshTaskRootCallIds = getDshTaskRootCallIds(partsByMessageId, lateTaskEvents)
  const artifactByPath = new Map<string, AgentArtifactFile>()

  for (const message of messages) {
    const parts = partsByMessageId[message.id] ?? message.parts ?? []
    parts.forEach((part, partIndex) => {
      if (isDataUIPart(part) && part.type === 'data-agent-task-event') {
        applyAgentTaskEvent(runTaskMap, part.data, dshTaskRootCallIds, message.id, runTaskOriginMessageIds)
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
    applyAgentTaskEvent(runTaskMap, data, dshTaskRootCallIds)
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
