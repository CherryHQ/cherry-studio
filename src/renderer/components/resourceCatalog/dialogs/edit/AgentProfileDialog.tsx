import { AlertCircle, CalendarClock, MessageSquare, Settings2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogTitle, EmojiAvatar, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { formatTaskCardTime, TaskRunSummaryLine } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useTasks } from '@renderer/hooks/agent/useTasks'
import { useModelById } from '@renderer/hooks/useModel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'

import { resourceDialogCloseButtonClassName } from '../components/EditDialogShared'

const TASK_STATUS_KEYS = {
  active: 'agent.tasks.status.active',
  paused: 'agent.tasks.status.paused',
  completed: 'agent.tasks.status.completed',
  missed: 'agent.tasks.status.missed'
} as const

type AgentProfileDialogProps = {
  open: boolean
  agent: AgentDetail | null
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  /** Shown right after "Agent create" when part of the automatic setup fell back. */
  setupIncomplete?: boolean
}

/**
 * What opening an Agent shows first: who it is (avatar, name, model, description) and what it runs
 * on its own (scheduled tasks). Configuration lives one step away in "More settings".
 */
export function AgentProfileDialog({
  open,
  agent,
  onOpenChange,
  onOpenSettings,
  setupIncomplete = false
}: AgentProfileDialogProps) {
  const { t } = useTranslation()
  const { model } = useModelById(agent?.model ?? null)
  const { tasks } = useTasks(agent?.id ?? null)
  const { skills } = useInstalledSkills(agent?.id, { enabled: Boolean(agent) })
  const enabledSkillCount = useMemo(() => skills.filter((skill) => skill.isEnabled).length, [skills])
  const enabledToolCount = useMemo(() => {
    if (!agent) return 0
    const disabled = new Set(agent.disabledTools ?? [])
    return AGENT_RUNTIME_CAPABILITIES[agent.type].builtinTools().filter((tool) => !disabled.has(tool.id)).length
  }, [agent])

  if (!agent) return null

  // Builtin Agents keep their description in the bundle until the user edits it.
  const description = getAgentDescriptionForDisplay(agent, t).trim()

  const startChat = () => {
    onOpenChange(false)
    openRoute('/app/agents', { agentId: agent.id })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('flex max-h-[min(640px,80vh)] flex-col gap-0 p-0', resourceDialogCloseButtonClassName)}>
        <div className="flex shrink-0 flex-col gap-4 px-7 pt-8 pb-5">
          <div className="flex items-start gap-4 pr-6">
            <EmojiAvatar size={64} fontSize={32} className="shrink-0 cursor-default rounded-[20%] hover:opacity-100">
              {getAgentAvatarFromConfiguration(agent.configuration)}
            </EmojiAvatar>
            <div className="min-w-0 flex-1 pt-1">
              <DialogTitle className="truncate font-semibold text-lg leading-tight">{agent.name}</DialogTitle>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
                {agent.model ? (
                  <>
                    <span className="flex min-w-0 items-center gap-1">
                      {model ? <ModelAvatar model={model} size={14} /> : null}
                      <span className="truncate">{agent.modelName ?? agent.model}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span>
                  {t('library.config.agent.profile.capabilities', {
                    skills: enabledSkillCount,
                    tools: enabledToolCount
                  })}
                </span>
              </div>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-foreground/80 text-sm leading-relaxed">
            {description || (
              <span className="text-muted-foreground">{t('library.config.agent.profile.no_description')}</span>
            )}
          </p>
          {setupIncomplete ? (
            <div className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-warning-subtle-foreground text-xs">
              <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
              {t('library.config.agent.profile.setup_incomplete')}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-border-subtle border-t px-7 pt-4 pb-5">
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <span className="font-medium text-sm">{t('settings.scheduledTasks.title')}</span>
            {tasks.length > 0 ? <span className="text-muted-foreground text-xs">{tasks.length}</span> : null}
          </div>
          {tasks.length > 0 ? (
            <ScrollArea className="-mx-3 min-h-0 flex-1">
              <ul className="flex flex-col gap-0.5">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 rounded-lg px-3 py-2">
                    <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{task.name}</div>
                      <div className="truncate text-muted-foreground text-xs">
                        {getTriggerSummary(task.trigger, t)}
                        {task.nextRun
                          ? ` · ${t('library.config.agent.profile.next_run', { time: formatTaskCardTime(task.nextRun) })}`
                          : null}
                      </div>
                    </div>
                    {/* The last run says more than the schedule state; paused/missed still need flagging. */}
                    {task.runSummary && task.status !== 'paused' && task.status !== 'missed' ? (
                      <span className="shrink-0 text-xs">
                        <TaskRunSummaryLine summary={task.runSummary} />
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'shrink-0 text-xs',
                          task.status === 'paused' || task.status === 'missed'
                            ? 'text-warning-subtle-foreground'
                            : 'text-muted-foreground'
                        )}>
                        {t(TASK_STATUS_KEYS[task.status])}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border border-dashed px-4 py-6 text-center">
              <CalendarClock aria-hidden className="size-5 text-muted-foreground" />
              <div className="text-sm">{t('library.config.agent.profile.no_tasks')}</div>
              <div className="text-muted-foreground text-xs">{t('library.config.agent.profile.no_tasks_hint')}</div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-border-subtle border-t px-6 py-3">
          <Button type="button" variant="outline" onClick={onOpenSettings}>
            <Settings2 />
            {t('library.config.agent.profile.more_settings')}
          </Button>
          <Button type="button" onClick={startChat}>
            <MessageSquare />
            {t('library.config.agent.profile.start_chat')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
