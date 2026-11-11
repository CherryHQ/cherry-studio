import {
  Bot,
  CheckCircle,
  Circle,
  CircleStop,
  Gauge,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Monitor,
  Package,
  Terminal,
  Workflow
} from 'lucide-react'
import { createContext, Fragment, type ReactNode, use, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CommandShortcut } from '@renderer/components/command'
import { ComputerUseAppIcon } from '@renderer/components/ComputerUseAppIcon'
import { OpenTargetButton } from '@renderer/components/OpenTarget'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { AgentWorkspaceType } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentDetailsSectionConfig } from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import type { ComputerUseControl } from '@shared/ipc/schemas/computerUse'

import { AgentDetailsCustomize } from './AgentDetailsCustomize'
import type {
  AgentRightPaneStatus,
  AgentRunTask,
  AgentStatusTask,
  AgentToolFlowOpenInput
} from './agentRightPaneProjection'

const logger = loggerService.withContext('AgentSessionDetails')

interface RunTaskStops {
  pending: ReadonlySet<string>
  stop: (sessionId: string, taskId: string) => Promise<void>
}

const RunTaskStopsContext = createContext<RunTaskStops | null>(null)

export function AgentRunTaskStopsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const pendingRef = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(pendingRef.current)

  const stop = async (sessionId: string, taskId: string) => {
    const key = JSON.stringify([sessionId, taskId])
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    setPending(new Set(pendingRef.current))
    let accepted = false
    try {
      accepted = await ipcApi.request('ai.agent.session.stop_background_task', { sessionId, taskId })
    } catch (error) {
      logger.warn('Failed to stop background task', { sessionId, taskId, error })
    }
    if (!accepted) {
      pendingRef.current.delete(key)
      setPending(new Set(pendingRef.current))
      toast.error(t('agent.right_pane.status.stop_run_task_failed'))
    }
  }

  return <RunTaskStopsContext value={{ pending, stop }}>{children}</RunTaskStopsContext>
}

function RunTaskStopButton({ sessionId, taskId }: { sessionId?: string; taskId: string }) {
  const { t } = useTranslation()
  const stops = use(RunTaskStopsContext)
  if (!sessionId || !stops) return null
  const label = t('agent.right_pane.status.stop_run_task')

  return (
    <Tooltip content={label}>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={stops.pending.has(JSON.stringify([sessionId, taskId]))}
        aria-label={label}
        className="-mt-0.5 shrink-0 text-muted-foreground"
        onClick={() => void stops.stop(sessionId, taskId)}>
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
  onOpenArtifact,
  contextUsage,
  desktopControls = [],
  pendingDesktopControls,
  stopDesktopControl
}: {
  contextUsage?: ReactNode
  desktopControls?: ComputerUseControl[]
  pendingDesktopControls?: ReadonlySet<string>
  stopDesktopControl?: (control: ComputerUseControl) => Promise<void>
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
  const [preferences, persistSections] = usePreference('agent.details.sections')
  const defaults = getDefaultValue('agent.details.sections')
  const knownIds = new Set(defaults.map(({ id }) => id))
  const seen = new Set<string>()
  const sections = [...preferences, ...defaults].filter(({ id }) => {
    if (!knownIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  const saveSections = (next: AgentDetailsSectionConfig[]) => {
    void persistSections(next).catch(() => toast.error(t('common.error')))
  }
  const labels: Record<string, { label: string; icon: ReactNode }> = {
    workspace: { label: t('code.adv.permission_modes.workspace'), icon: <FolderOpen className="size-4" /> },
    desktop_control: { label: t('agent.right_pane.info.desktop_control.title'), icon: <Monitor className="size-4" /> },
    plan: { label: t('agent.right_pane.info.plan'), icon: <ListChecks className="size-4" /> },
    subagents: { label: t('agent.right_pane.info.subagents'), icon: <Bot className="size-4" /> },
    workflows: { label: t('agent.right_pane.info.workflows'), icon: <Workflow className="size-4" /> },
    shells: { label: t('agent.right_pane.info.shell_tasks'), icon: <Terminal className="size-4" /> },
    other: { label: t('agent.right_pane.info.other_tasks'), icon: <ListChecks className="size-4" /> },
    artifacts: { label: t('agent.right_pane.info.artifacts'), icon: <Package className="size-4" /> },
    context: { label: t('agent.right_pane.info.context'), icon: <Gauge className="size-4" /> }
  }
  const content: Record<string, ReactNode> = {
    workspace: workspaceLabel && (
      <div className="flex min-w-0 items-center gap-2 px-4 py-3">
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <Tooltip asChild content={workspacePath || workspaceLabel}>
          <span
            tabIndex={0}
            className="min-w-0 flex-1 truncate rounded-sm text-sm font-medium text-foreground focus-visible:bg-accent focus-visible:outline-none">
            {workspaceLabel}
          </span>
        </Tooltip>
        {workspacePath && (
          <OpenTargetButton
            targetPath={workspacePath}
            pathKind="directory"
            className="shrink-0 border-0"
            menuAction="select"
            primaryShortcut={<CommandShortcut command="agent.workspace.open" />}
            menuContentProps={{ className: 'w-70 max-w-[calc(100vw_-_24px)]', alignOffset: -16 }}
          />
        )}
      </div>
    ),
    desktop_control: desktopControls.some((row) => row.appId) ? (
      <DetailsSection
        id="desktop_control"
        title={t('agent.right_pane.info.desktop_control.title')}
        icon={<Monitor className="size-4" />}
        summary={desktopControls.filter((row) => row.appId).length}>
        {desktopControls
          .filter((row) => row.appId)
          .map((row) => {
            const labels = {
              opening: t('agent.right_pane.info.desktop_control.opening'),
              active: t('agent.right_pane.info.desktop_control.active'),
              stopping: t('agent.right_pane.info.desktop_control.stopping'),
              stopped: t('agent.right_pane.info.desktop_control.stopped'),
              unconfirmed: t('agent.right_pane.info.desktop_control.unconfirmed')
            }
            const name = row.appName ?? row.appId
            const stopLabel = t('agent.right_pane.info.desktop_control.stop')
            return (
              <div
                key={JSON.stringify([row.ownerId, row.appId])}
                className="flex min-w-0 items-center gap-2 px-1 py-2 text-xs">
                <ComputerUseAppIcon app={{ name: name ?? row.label, identity: row.appIdentity }} />
                <span title={name} className="min-w-0 flex-1 truncate">
                  {name}
                </span>
                <span className="text-muted-foreground">{labels[row.status]}</span>
                {(row.status === 'opening' || row.status === 'active') && (
                  <Tooltip content={stopLabel}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={stopLabel}
                      disabled={pendingDesktopControls?.has(JSON.stringify([row.ownerId, row.appId]))}
                      onClick={() =>
                        void stopDesktopControl?.(row).catch(() =>
                          toast.error(t('agent.right_pane.info.desktop_control.stop_failed'))
                        )
                      }>
                      <CircleStop size={14} />
                    </Button>
                  </Tooltip>
                )}
              </div>
            )
          })}
      </DetailsSection>
    ) : null,
    plan: status.tasks.length > 0 && (
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
    ),
    subagents: (
      <RunSection
        id="subagents"
        title={t('agent.right_pane.info.subagents')}
        icon={<Bot className="size-4" />}
        tasks={subagents}
        sessionId={sessionId}
        onOpenFlow={onOpenFlow}
      />
    ),
    workflows: (
      <RunSection
        id="workflows"
        title={t('agent.right_pane.info.workflows')}
        icon={<Workflow className="size-4" />}
        tasks={workflows}
        sessionId={sessionId}
      />
    ),
    shells: (
      <RunSection
        id="shells"
        title={t('agent.right_pane.info.shell_tasks')}
        icon={<Terminal className="size-4" />}
        tasks={shells}
        sessionId={sessionId}
      />
    ),
    other: (
      <RunSection
        id="other"
        title={t('agent.right_pane.info.other_tasks')}
        icon={<ListChecks className="size-4" />}
        tasks={others}
        sessionId={sessionId}
      />
    ),
    artifacts: onOpenArtifact && status.artifacts.length > 0 && (
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
    ),
    context: contextUsage && <div className="border-t border-border-subtle p-3">{contextUsage}</div>
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <span className="text-xs text-muted-foreground">{t('agent.right_pane.tabs.details')}</span>
        <AgentDetailsCustomize
          items={sections.map((section) => ({ ...section, ...labels[section.id] }))}
          onChange={saveSections}
          onReset={() => saveSections(defaults)}
          isDefault={
            sections.length === defaults.length &&
            sections.every(
              (section, index) => section.id === defaults[index].id && section.visible === defaults[index].visible
            )
          }
        />
      </div>
      <Accordion type="multiple">
        {sections
          .filter(({ visible }) => visible)
          .map(({ id }) => (
            <Fragment key={id}>{content[id]}</Fragment>
          ))}
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
    <AccordionItem value={id} className="mx-3 border-border-subtle last:border-0">
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
