import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { StaticMarkdown } from '@renderer/components/markdown'

import { AgentToolsType } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'

const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

type TaskStatus = z.infer<typeof TaskStatusSchema>

const TaskDisplaySchema = z.object({
  id: z.string().optional().catch(undefined),
  subject: z.string().optional().catch(undefined),
  status: TaskStatusSchema.optional().catch(undefined),
  owner: z.string().optional().catch(undefined)
})

export type TaskListItem = z.infer<typeof TaskDisplaySchema>

const TaskStopDisplaySchema = z.object({
  message: z.string().optional().catch(undefined),
  task_id: z.string().optional().catch(undefined)
})

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
      return 'border-success-border bg-success-subtle text-success-subtle-foreground'
    case 'in_progress':
      return 'border-info-border bg-info-subtle text-info-subtle-foreground'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

function getTaskTargetLabel(taskId: string | undefined, t: ReturnType<typeof useTranslation>['t']): string | undefined {
  return taskId ? t('message.tools.activity.taskId', { id: taskId }) : undefined
}

export function TaskListView({ tasks, t }: { tasks: TaskListItem[]; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="space-y-1.5">
      {tasks.map((task, index) => (
        <div key={task.id ?? index} className="flex min-w-0 items-start gap-2 rounded-md bg-muted/30 p-2">
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
        <StaticMarkdown>{text}</StaticMarkdown>
      </div>
    </div>
  )
}

export function TaskCreateTool({ input }: ToolDisplayProps): ToolDisclosureItem {
  return {
    key: AgentToolsType.TaskCreate,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskCreate}
        args={input}
        params={
          <SkeletonValue
            value={readToolStringArgument(input, 'description') ?? readToolStringArgument(input, 'subject')}
            width="150px"
          />
        }
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function TaskGetTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()

  const rawTask =
    output !== null && typeof output === 'object' && !Array.isArray(output) && 'task' in output
      ? output.task
      : undefined

  const decodedTask = TaskDisplaySchema.safeParse(rawTask)
  const task = decodedTask.success ? decodedTask.data : undefined
  const taskTarget = getTaskTargetLabel(readToolStringArgument(input, 'taskId'), t)

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

export function TaskUpdateTool({ input }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const taskTarget = getTaskTargetLabel(readToolStringArgument(input, 'taskId'), t)

  return {
    key: AgentToolsType.TaskUpdate,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TaskUpdate}
        args={input}
        params={
          <SkeletonValue
            value={
              readToolStringArgument(input, 'description') ?? readToolStringArgument(input, 'subject') ?? taskTarget
            }
            width="150px"
          />
        }
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function TaskListTool({ output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()

  const rawTasks =
    output !== null && typeof output === 'object' && !Array.isArray(output) && 'tasks' in output
      ? output.tasks
      : undefined

  const tasks = Array.isArray(rawTasks)
    ? rawTasks.flatMap((task) => {
        const decodedTask = TaskDisplaySchema.safeParse(task)

        return decodedTask.success ? [decodedTask.data] : []
      })
    : []

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
    children: tasks.length ? <TaskListView tasks={tasks} t={t} /> : undefined
  }
}

export function TaskOutputTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const { data: truncatedText, isTruncated, originalLength } = truncateOutput(output)
  const taskTarget = getTaskTargetLabel(readToolStringArgument(input, 'task_id'), t)

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

export function TaskStopTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()

  const rawOutput =
    output !== null && typeof output === 'object' && !Array.isArray(output) && 'message' in output ? output : undefined

  const decodedOutput = TaskStopDisplaySchema.safeParse(rawOutput)
  const outputData = decodedOutput.success ? decodedOutput.data : undefined

  const taskId =
    outputData?.task_id ?? readToolStringArgument(input, 'task_id') ?? readToolStringArgument(input, 'shell_id')

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
