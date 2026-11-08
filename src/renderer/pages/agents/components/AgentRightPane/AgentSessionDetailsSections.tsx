import {
  Bot,
  CheckCircle,
  Circle,
  CircleStop,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Package,
  Terminal,
  Workflow
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { OpenTargetButton } from '@renderer/components/OpenTarget'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { AgentWorkspaceType } from '@shared/data/api/schemas/agentWorkspaces'

import type {
  AgentRightPaneStatus,
  AgentRunTask,
  AgentStatusTask,
  AgentToolFlowOpenInput
} from './agentRightPaneProjection'

const logger = loggerService.withContext('AgentSessionDetails')

// The runtime owns the final status; pending disables duplicate stop submissions.
function RunTaskStopButton({ sessionId, taskId }: { sessionId?: string; taskId: string }) {
  const { t } = useTranslation()
  const [stopping, setStopping] = useState(false)

  if (!sessionId) return null

  const label = t('agent.right_pane.status.stop_run_task')

  return (
    <Tooltip content={label}>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={stopping}
        aria-label={label}
        className="-mt-0.5 shrink-0 text-muted-foreground"
        onClick={async () => {
          setStopping(true)
          try {
            const stopped = await ipcApi.request('ai.agent.session.stop_background_task', { sessionId, taskId })
            if (!stopped) {
              setStopping(false)
              toast.error(t('agent.right_pane.status.stop_run_task_failed'))
            }
          } catch (error) {
            logger.warn('Failed to stop background task', { taskId, error })
            setStopping(false)
            toast.error(t('agent.right_pane.status.stop_run_task_failed'))
          }
        }}>
        <CircleStop size={14} />
      </Button>
    </Tooltip>
  )
}

/** A shell run is a command, not an agent — the two read differently, so they get separate sections. */
function isShellRunTask(task: AgentRunTask): boolean {
  const type = task.taskType ?? ''
  return type.includes('bash') || type.includes('shell')
}

function isSubagentRunTask(task: AgentRunTask): boolean {
  return task.taskType === 'subagent' || task.taskType === 'local_agent' || Boolean(task.subagentType)
}

function isLocalWorkflowRunTask(task: AgentRunTask): boolean {
  return task.taskType === 'local_workflow'
}

function RunTaskList({
  tasks,
  sessionId,
  onOpenFlow
}: {
  tasks: AgentRunTask[]
  sessionId?: string
  onOpenFlow?: (input: AgentToolFlowOpenInput) => void
}) {
  return (
    <div className="space-y-1.5">
      {tasks.map((task) => {
        const toolCallId = onOpenFlow && isSubagentRunTask(task) ? task.toolUseId : undefined
        const content = (
          <>
            <TaskStatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              {/* Rows persisted before summaries were kept out of titles can carry prose here — clamp it. */}
              <div
                title={task.status === 'in_progress' && task.activeText ? task.activeText : task.title}
                className="line-clamp-2 text-xs leading-5 wrap-break-word text-foreground">
                {task.status === 'in_progress' && task.activeText ? task.activeText : task.title}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {[task.subagentType ?? task.workflowName ?? task.taskType, formatRunTaskUsage(task.usage)]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </>
        )

        return (
          <div key={task.id} className="flex items-start gap-2 rounded-md px-1 py-2">
            {toolCallId ? (
              <Button
                variant="ghost"
                type="button"
                className="-m-1 flex h-auto min-w-0 flex-1 whitespace-normal items-start gap-2 rounded-sm p-1 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => onOpenFlow?.({ toolCallId, title: task.title })}>
                {content}
              </Button>
            ) : (
              content
            )}
            {task.status === 'in_progress' && <RunTaskStopButton sessionId={sessionId} taskId={task.id} />}
          </div>
        )
      })}
    </div>
  )
}

function WorkflowRunTaskList({ tasks, sessionId }: { tasks: AgentRunTask[]; sessionId?: string }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-1.5">
      {tasks.map((task) => {
        const activity = task.status === 'in_progress' ? task.activeText : undefined
        const usage = formatRunTaskUsage(task.usage, (count) => t('agent.right_pane.status.tool_uses', { count }))
        const metadata = [task.lastToolName, usage].filter(Boolean).join(' · ')

        return (
          <div key={task.id} className="flex min-w-0 items-start gap-2 rounded-md px-1 py-2">
            <TaskStatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div
                title={task.workflowName ?? task.title}
                className="line-clamp-2 text-xs leading-5 wrap-break-word text-foreground">
                {task.workflowName ?? task.title}
              </div>
              {task.summary && task.summary !== task.workflowName && task.summary !== task.title ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 wrap-break-word text-muted-foreground">
                  {task.summary}
                </div>
              ) : null}
              {activity && activity !== task.title && activity !== task.summary ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 wrap-break-word text-muted-foreground">
                  {activity}
                </div>
              ) : null}
              {metadata ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{metadata}</div> : null}
            </div>
            {task.status === 'in_progress' && <RunTaskStopButton sessionId={sessionId} taskId={task.id} />}
          </div>
        )
      })}
    </div>
  )
}

function formatRunTaskUsage(
  usage: AgentRunTask['usage'],
  formatToolUses?: (count: number) => string
): string | undefined {
  if (!usage) return undefined
  const parts: string[] = []
  if (typeof usage.totalTokens === 'number') {
    parts.push(usage.totalTokens >= 1000 ? `${(usage.totalTokens / 1000).toFixed(1)}k` : String(usage.totalTokens))
  }
  if (typeof usage.toolUses === 'number' && formatToolUses) parts.push(formatToolUses(usage.toolUses))
  if (typeof usage.durationMs === 'number') parts.push(`${Math.round(usage.durationMs / 1000)}s`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function TaskStatusIcon({ status }: { status: AgentStatusTask['status'] | AgentRunTask['status'] }) {
  const { t } = useTranslation()
  const label = {
    pending: t('message.tools.pending'),
    in_progress: t('message.tools.status.running'),
    completed: t('common.completed'),
    error: t('message.tools.status.error'),
    stopped: t('message.tools.cancelled')
  }[status]
  let icon: ReactNode

  switch (status) {
    case 'completed':
      icon = <CheckCircle className="size-3.5" />
      break
    case 'in_progress':
      icon = <Loader2 className="size-3.5 animate-spin" />
      break
    case 'error':
      icon = <Circle className="size-3.5" />
      break
    case 'stopped':
      icon = <CircleStop className="size-3.5" />
      break
    case 'pending':
    default:
      icon = <Circle className="size-3.5" />
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center',
        {
          completed: 'text-success',
          in_progress: 'text-info',
          error: 'text-error',
          pending: 'text-muted-foreground',
          stopped: 'text-muted-foreground'
        }[status]
      )}>
      {icon}
    </span>
  )
}

export function AgentSessionDetailsSections({
  status,
  sessionId,
  workspacePath,
  workspaceName,
  workspaceType,
  onOpenFlow,
  onOpenArtifact
}: {
  status: AgentRightPaneStatus
  sessionId?: string
  workspacePath?: string
  workspaceName?: string
  workspaceType?: AgentWorkspaceType
  onOpenFlow?: (input: AgentToolFlowOpenInput) => void
  onOpenArtifact?: (path: string) => void
}) {
  const { t } = useTranslation()
  const workflows = status.runTasks.filter(isLocalWorkflowRunTask)
  const shells = status.runTasks.filter((task) => !isLocalWorkflowRunTask(task) && isShellRunTask(task))
  const subagents = status.runTasks.filter(
    (task) => !isLocalWorkflowRunTask(task) && !isShellRunTask(task) && isSubagentRunTask(task)
  )
  const others = status.runTasks.filter(
    (task) => !isSubagentRunTask(task) && !isLocalWorkflowRunTask(task) && !isShellRunTask(task)
  )
  const currentTask = status.tasks.find((task) => task.status === 'in_progress')
  const workspaceLabel =
    workspaceType === 'system' ? t('agent.session.workspace_selector.no_project') : workspaceName || workspacePath
  return (
    <>
      {workspaceLabel && (
        <div className="space-y-1 border-b border-border-subtle p-3">
          {workspacePath ? (
            <OpenTargetButton
              targetPath={workspacePath}
              pathKind="directory"
              tooltip={workspacePath}
              className="w-full"
              primaryClassName="min-w-0 flex-1 justify-start text-muted-foreground"
              primaryContent={
                <>
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate">{workspaceLabel}</span>
                </>
              }
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderOpen className="size-4" />
              {workspaceLabel}
            </div>
          )}
          {workspacePath && (
            <p className="truncate px-1 text-xs text-muted-foreground" title={workspacePath}>
              {workspacePath}
            </p>
          )}
        </div>
      )}
      <Accordion type="multiple" className="px-3">
        {status.tasks.length > 0 && (
          <DetailsSection
            id="plan"
            title={t('agent.right_pane.info.plan')}
            icon={<ListChecks className="size-4" />}
            subtitle={currentTask?.activeText || currentTask?.title}
            summary={t('agent.right_pane.status.task_count', {
              completed: status.completedTaskCount,
              total: status.totalTaskCount
            })}>
            <ol className="space-y-1">
              {status.tasks.map((task) => (
                <li key={task.id} className="flex gap-2 text-xs">
                  <TaskStatusIcon status={task.status} />
                  <span>{task.title}</span>
                </li>
              ))}
            </ol>
          </DetailsSection>
        )}
        <RunSection
          id="subagents"
          title={t('agent.right_pane.info.subagents')}
          icon={<Bot className="size-4" />}
          tasks={subagents}
          sessionId={sessionId}
          onOpenFlow={onOpenFlow}
        />
        <RunSection
          id="workflows"
          title={t('agent.right_pane.info.workflows')}
          icon={<Workflow className="size-4" />}
          tasks={workflows}
          sessionId={sessionId}
        />
        <RunSection
          id="shells"
          title={t('agent.right_pane.info.shell_tasks')}
          icon={<Terminal className="size-4" />}
          tasks={shells}
          sessionId={sessionId}
        />
        <RunSection
          id="other"
          title={t('agent.right_pane.info.other_tasks')}
          icon={<ListChecks className="size-4" />}
          tasks={others}
          sessionId={sessionId}
        />
        {onOpenArtifact && status.artifacts.length > 0 && (
          <DetailsSection
            id="artifacts"
            title={t('agent.right_pane.info.artifacts')}
            icon={<Package className="size-4" />}
            summary={status.artifacts.length}>
            <ul>
              {status.artifacts.map((artifact) => (
                <li key={`${artifact.toolCallId}-${artifact.path}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full min-w-0 justify-start text-xs"
                    title={artifact.path}
                    onClick={() => onOpenArtifact(artifact.path)}>
                    <FileText className="size-4 shrink-0" />
                    <span className="truncate">{artifact.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </DetailsSection>
        )}
      </Accordion>
    </>
  )
}

function DetailsSection({
  id,
  title,
  icon,
  summary,
  subtitle,
  children
}: {
  id: string
  title: string
  icon: ReactNode
  summary: ReactNode
  subtitle?: string
  children: ReactNode
}) {
  return (
    <AccordionItem value={id} className="border-border-subtle last:border-0">
      <AccordionTrigger className="gap-2 py-3 text-xs font-normal">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground [&>svg]:shrink-0">
            {icon}
            <span className="shrink-0">{title}</span>
            <span className="ml-auto text-right text-[11px] tabular-nums">{summary}</span>
          </span>
          {subtitle && (
            <span title={subtitle} className="mt-1 block truncate pl-6 text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-3">{children}</AccordionContent>
    </AccordionItem>
  )
}

const TASK_ORDER = { in_progress: 0, error: 1, pending: 2, completed: 3, stopped: 4 }

function RunSection({
  id,
  title,
  icon,
  tasks,
  sessionId,
  onOpenFlow
}: {
  id: string
  title: string
  icon: ReactNode
  tasks: AgentRunTask[]
  sessionId?: string
  onOpenFlow?: (input: AgentToolFlowOpenInput) => void
}) {
  const { t } = useTranslation()
  if (!tasks.length) return null
  const current = tasks
    .filter((task) => task.status !== 'completed' && task.status !== 'stopped')
    .toSorted((a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status])
  const finished = tasks.filter((task) => task.status === 'completed' || task.status === 'stopped')
  const labels = {
    in_progress: t('message.tools.status.running'),
    error: t('message.tools.status.error'),
    pending: t('message.tools.pending')
  }
  const summary =
    (['in_progress', 'error', 'pending'] as const)
      .flatMap((state) => {
        const count = tasks.filter((task) => task.status === state).length
        return count ? [`${count} ${labels[state]}`] : []
      })
      .join(' · ') || String(tasks.length)
  const renderTasks = (items: AgentRunTask[]) =>
    id === 'workflows' ? (
      <WorkflowRunTaskList tasks={items} sessionId={sessionId} />
    ) : (
      <RunTaskList tasks={items} sessionId={sessionId} onOpenFlow={onOpenFlow} />
    )
  return (
    <DetailsSection id={id} title={title} icon={icon} summary={summary}>
      {renderTasks(current)}
      {finished.length > 0 && (
        <Accordion type="single" collapsible>
          <DetailsSection
            id="finished"
            title={t('agent.right_pane.info.finished_tasks')}
            icon={null}
            summary={finished.length}>
            {renderTasks(finished)}
          </DetailsSection>
        </Accordion>
      )}
    </DetailsSection>
  )
}
