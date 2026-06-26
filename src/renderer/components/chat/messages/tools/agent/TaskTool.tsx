import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type ToolRendererProps } from './types'

type TaskStatus = 'pending' | 'in_progress' | 'completed'

interface TaskListItem {
  id: string
  subject: string
  status: TaskStatus
  owner?: string
}

type TaskGetOutputObject = Exclude<NonNullable<ToolRendererProps<typeof AgentToolsType.TaskGet>['output']>, string>
type TaskListOutputObject = Exclude<NonNullable<ToolRendererProps<typeof AgentToolsType.TaskList>['output']>, string>
type TaskStopOutputObject = Exclude<NonNullable<ToolRendererProps<typeof AgentToolsType.TaskStop>['output']>, string>

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaskGetOutputObject(
  output: ToolRendererProps<typeof AgentToolsType.TaskGet>['output']
): output is TaskGetOutputObject {
  return isObject(output) && 'task' in output
}

function isTaskListOutputObject(
  output: ToolRendererProps<typeof AgentToolsType.TaskList>['output']
): output is TaskListOutputObject {
  return isObject(output) && 'tasks' in output
}

function isTaskStopOutputObject(
  output: ToolRendererProps<typeof AgentToolsType.TaskStop>['output']
): output is TaskStopOutputObject {
  return isObject(output) && 'message' in output
}

function getStatusLabel(status: TaskStatus | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  switch (status) {
    case 'completed':
      return t('message.tools.completed')
    case 'in_progress':
      return t('message.tools.invoking')
    case 'pending':
      return t('message.tools.pending', 'Pending')
    default:
      return ''
  }
}

function getStatusClassName(status: TaskStatus | undefined): string {
  switch (status) {
    case 'completed':
      return 'border-success-border bg-success-bg text-success-text'
    case 'in_progress':
      return 'border-info-border bg-info-bg text-info-text'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function getTaskTargetLabel(taskId: string | undefined, t: ReturnType<typeof useTranslation>['t']): string | undefined {
  return taskId ? t('message.tools.activity.taskId', { id: taskId }) : undefined
}

function TaskListView({ tasks, t }: { tasks: TaskListItem[]; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="space-y-1.5">
      {tasks.map((task) => (
        <div key={task.id} className="flex min-w-0 items-start gap-2 rounded-md bg-muted/30 p-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground">{task.subject}</div>
            {task.owner && <div className="mt-0.5 truncate text-muted-foreground text-xs">{task.owner}</div>}
          </div>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${getStatusClassName(task.status)}`}>
            {getStatusLabel(task.status, t)}
          </span>
        </div>
      ))}
    </div>
  )
}

function TaskTextOutput({ text, t }: { text: string; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div>
      <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
      <div className="rounded-md bg-muted/30 p-2">
        <Streamdown mode="static">{text}</Streamdown>
      </div>
    </div>
  )
}

export function TaskCreateTool({ input }: ToolRendererProps<typeof AgentToolsType.TaskCreate>): ToolDisclosureItem {
  return {
    key: AgentToolsType.TaskCreate,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskCreate}
        args={input}
        params={<SkeletonValue value={input?.description ?? input?.subject} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function TaskGetTool({ input, output }: ToolRendererProps<typeof AgentToolsType.TaskGet>): ToolDisclosureItem {
  const { t } = useTranslation()
  const task = isTaskGetOutputObject(output) ? output.task : undefined
  const taskTarget = getTaskTargetLabel(input?.taskId, t)

  return {
    key: AgentToolsType.TaskGet,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskGet}
        args={input}
        params={<SkeletonValue value={taskTarget} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: task ? (
      <TaskListView tasks={[{ id: task.id, subject: task.subject, status: task.status }]} t={t} />
    ) : undefined
  }
}

export function TaskUpdateTool({ input }: ToolRendererProps<typeof AgentToolsType.TaskUpdate>): ToolDisclosureItem {
  const { t } = useTranslation()
  const taskTarget = getTaskTargetLabel(input?.taskId, t)

  return {
    key: AgentToolsType.TaskUpdate,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskUpdate}
        args={input}
        params={<SkeletonValue value={input?.description ?? input?.subject ?? taskTarget} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function TaskListTool({ output }: ToolRendererProps<typeof AgentToolsType.TaskList>): ToolDisclosureItem {
  const { t } = useTranslation()
  const tasks = isTaskListOutputObject(output) ? output.tasks : []

  return {
    key: AgentToolsType.TaskList,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskList}
        params={<SkeletonValue value={t('message.tools.activity.taskList')} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: tasks.length ? (
      <TaskListView
        tasks={tasks.map((task) => ({
          id: task.id,
          subject: task.subject,
          status: task.status,
          owner: task.owner
        }))}
        t={t}
      />
    ) : undefined
  }
}

export function TaskOutputTool({
  input,
  output
}: ToolRendererProps<typeof AgentToolsType.TaskOutput>): ToolDisclosureItem {
  const { t } = useTranslation()
  const { data: truncatedText, isTruncated, originalLength } = truncateOutput(output)
  const taskTarget = getTaskTargetLabel(input?.task_id, t)

  return {
    key: AgentToolsType.TaskOutput,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskOutput}
        args={input}
        params={<SkeletonValue value={taskTarget} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: truncatedText ? (
      <div>
        <TaskTextOutput text={truncatedText} t={t} />
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    ) : undefined
  }
}

export function TaskStopTool({ input, output }: ToolRendererProps<typeof AgentToolsType.TaskStop>): ToolDisclosureItem {
  const { t } = useTranslation()
  const outputData = isTaskStopOutputObject(output) ? output : undefined
  const taskId = outputData?.task_id ?? input?.task_id ?? input?.shell_id
  const taskTarget = getTaskTargetLabel(taskId, t)

  return {
    key: AgentToolsType.TaskStop,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskStop}
        args={input}
        params={<SkeletonValue value={taskTarget} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: outputData?.message ? <TaskTextOutput text={outputData.message} t={t} /> : undefined
  }
}
