import { ChevronRight, Clock, Database, FolderOpen, GitBranch, Sparkles, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'
import { requestComposerPrefill } from '@renderer/components/composer/variants/shared/useComposerPrefill'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { getTriggerSummary } from '@renderer/components/ScheduledTask/scheduleForm'
import { TaskFormDialog } from '@renderer/components/ScheduledTask/TaskFormDialog'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentSessionStreamStatuses } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import { useSetTaskEnabled, useUpdateTask } from '@renderer/hooks/agent/useTasks'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentEntity, ScheduledTaskEntity } from '@shared/data/types/agent'
import type { AgentTaskPatch } from '@shared/ipc/schemas/ai'

import { ProfilePaneSection, ProfilePaneSectionAction } from './ProfilePaneParts'

const EMPTY_TASKS: ScheduledTaskEntity[] = []
/** Copy of each suggestion; `prompt` is what goes into the composer. */
const SUGGESTION_COPY = {
  feishu: {
    label: 'chat.profile_pane.suggestions.feishu.label',
    hint: 'chat.profile_pane.suggestions.feishu.hint',
    prompt: 'chat.profile_pane.suggestions.feishu.prompt'
  },
  wechat: {
    label: 'chat.profile_pane.suggestions.wechat.label',
    hint: 'chat.profile_pane.suggestions.wechat.hint',
    prompt: 'chat.profile_pane.suggestions.wechat.prompt'
  },
  daily: {
    label: 'chat.profile_pane.suggestions.daily.label',
    hint: 'chat.profile_pane.suggestions.daily.hint',
    prompt: 'chat.profile_pane.suggestions.daily.prompt'
  },
  github: {
    label: 'chat.profile_pane.suggestions.github.label',
    hint: 'chat.profile_pane.suggestions.github.hint',
    prompt: 'chat.profile_pane.suggestions.github.prompt'
  },
  skills: {
    label: 'chat.profile_pane.suggestions.skills.label',
    hint: 'chat.profile_pane.suggestions.skills.hint',
    prompt: 'chat.profile_pane.suggestions.skills.prompt'
  },
  memory: {
    label: 'chat.profile_pane.suggestions.memory.label',
    hint: 'chat.profile_pane.suggestions.memory.hint',
    prompt: 'chat.profile_pane.suggestions.memory.prompt'
  },
  knowledge: {
    label: 'chat.profile_pane.suggestions.knowledge.label',
    hint: 'chat.profile_pane.suggestions.knowledge.hint'
  }
} as const

const GITHUB_PATTERN = /github/i

export interface AgentProfileWorkspace {
  path: string
  /** Opens the workspace in the Files pane; absent when that pane cannot show it. */
  open?: () => void
}

/** The Agent's activity: scheduled tasks, what to set up next, and where it works. */
export function AgentProfileActivity({
  agent,
  sessionId,
  workspace
}: {
  agent: AgentEntity
  /** The conversation's session; text from the pane goes into its composer. */
  sessionId?: string
  workspace?: AgentProfileWorkspace
}) {
  const { data: taskPage, refetch: refetchTasks } = useQuery('/agents/:agentId/tasks', {
    params: { agentId: agent.id },
    query: { limit: 100 }
  })
  useDataChange('/agent-tasks', () => void refetchTasks())
  const tasks = taskPage?.items ?? EMPTY_TASKS
  const fillComposer = sessionId
    ? (text: string) => requestComposerPrefill(buildAgentSessionTopicId(sessionId), text)
    : undefined

  return (
    <>
      <ScheduledTasksSection agent={agent} tasks={tasks} onFillComposer={fillComposer} />
      <SuggestionsSection agent={agent} hasTasks={tasks.length > 0} onFillComposer={fillComposer} />
      {workspace ? <WorkspaceSection workspace={workspace} sessionId={sessionId} /> : null}
    </>
  )
}

function ScheduledTasksSection({
  agent,
  tasks,
  onFillComposer
}: {
  agent: AgentEntity
  tasks: ScheduledTaskEntity[]
  onFillComposer?: (text: string) => void
}) {
  const { t } = useTranslation()
  const { setTaskEnabled } = useSetTaskEnabled()
  const { updateTask } = useUpdateTask()
  const [editingTask, setEditingTask] = useState<ScheduledTaskEntity | null>(null)
  const agents = useMemo(() => [{ id: agent.id, name: agent.name }], [agent.id, agent.name])

  return (
    <ProfilePaneSection
      title={t('chat.profile_pane.tasks.title')}
      action={
        onFillComposer ? (
          <ProfilePaneSectionAction onClick={() => onFillComposer(t('chat.profile_pane.tasks.new_prompt'))}>
            {t('chat.profile_pane.tasks.new')}
          </ProfilePaneSectionAction>
        ) : null
      }>
      {tasks.length ? (
        tasks.map((task) => (
          <div key={task.id} className="flex min-h-12 items-center gap-2.5 py-1.5">
            <button
              type="button"
              onClick={() => setEditingTask(task)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Clock
                className={cn('size-4 shrink-0', task.enabled ? 'text-muted-foreground' : 'text-foreground-tertiary')}
              />
              <span className="min-w-0">
                <span className="block truncate text-foreground text-sm">{task.name}</span>
                <span className="block truncate text-muted-foreground text-xs">
                  {task.enabled ? getTriggerSummary(task.trigger, t) : t('agent.tasks.status.paused')}
                </span>
              </span>
            </button>
            <Switch
              size="sm"
              aria-label={`${t(task.enabled ? 'agent.tasks.pause' : 'agent.tasks.resume')} ${task.name}`}
              checked={task.enabled}
              onCheckedChange={(enabled) => void setTaskEnabled(agent.id, task.id, enabled)}
            />
          </div>
        ))
      ) : (
        <div className="py-3 text-center text-foreground-tertiary text-xs">{t('chat.profile_pane.tasks.empty')}</div>
      )}
      {editingTask ? (
        <TaskFormDialog
          open
          task={editingTask}
          agents={agents}
          onOpenChange={(open) => !open && setEditingTask(null)}
          onUpdate={async (patch: AgentTaskPatch) => !!(await updateTask(agent.id, editingTask.id, patch))}
        />
      ) : null}
    </ProfilePaneSection>
  )
}

type SuggestionId = keyof typeof SUGGESTION_COPY
type Suggestion = { id: SuggestionId; icon: ReactNode; run: () => void }

function SuggestionsSection({
  agent,
  hasTasks,
  onFillComposer
}: {
  agent: AgentEntity
  hasTasks: boolean
  onFillComposer?: (text: string) => void
}) {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState(false)
  const caps = AGENT_RUNTIME_CAPABILITIES[agent.type]
  const { data: channels } = useQuery('/agent-channels', { query: { agentId: agent.id } })
  const { mcpServers } = useMcpServers(undefined, { enabled: caps.mcp })
  const linkedServerIds = new Set(agent.mcps ?? [])
  const githubLinked = mcpServers.some((server) => linkedServerIds.has(server.id) && GITHUB_PATTERN.test(server.name))

  if (hidden) return null

  const icon = (Icon: typeof Clock) => <Icon className="size-4 text-muted-foreground" />
  const channelIcon = (type: string) => (
    <img src={getChannelTypeIcon(type)} alt="" className="size-4 rounded-sm object-contain" />
  )
  const prompt = (id: Exclude<SuggestionId, 'knowledge'>) => () => onFillComposer?.(t(SUGGESTION_COPY[id].prompt))
  // Only what is not done yet; each entry asks the Agent to do it in this conversation.
  const candidates: (Suggestion | false)[] = [
    !!onFillComposer && !channels?.length && { id: 'feishu', icon: channelIcon('feishu'), run: prompt('feishu') },
    !!onFillComposer &&
      !channels?.some((channel) => channel.type === 'wechat') && {
        id: 'wechat',
        icon: channelIcon('wechat'),
        run: prompt('wechat')
      },
    !!onFillComposer && !hasTasks && { id: 'daily', icon: icon(Clock), run: prompt('daily') },
    !!onFillComposer && caps.mcp && !githubLinked && { id: 'github', icon: icon(GitBranch), run: prompt('github') },
    !!onFillComposer && caps.skills && { id: 'skills', icon: icon(Zap), run: prompt('skills') },
    !!onFillComposer && { id: 'memory', icon: icon(Sparkles), run: prompt('memory') },
    caps.knowledgeBases &&
      !agent.knowledgeBaseIds?.length && {
        id: 'knowledge',
        icon: icon(Database),
        run: () => openResourceEditDialog({ kind: 'agent', id: agent.id, initialTab: 'tools.knowledge' })
      }
  ]
  const suggestions = candidates.filter((item): item is Suggestion => Boolean(item))
  if (!suggestions.length) return null

  return (
    <ProfilePaneSection
      title={t('chat.profile_pane.suggestions.title')}
      framed={false}
      action={
        <ProfilePaneSectionAction onClick={() => setHidden(true)}>
          {t('chat.profile_pane.suggestions.hide')}
        </ProfilePaneSectionAction>
      }>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.run}
            className="flex items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{item.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground text-sm">{t(SUGGESTION_COPY[item.id].label)}</span>
              <span className="truncate text-muted-foreground text-xs">{t(SUGGESTION_COPY[item.id].hint)}</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground-tertiary" />
          </button>
        ))}
      </div>
    </ProfilePaneSection>
  )
}

function WorkspaceSection({ workspace, sessionId }: { workspace: AgentProfileWorkspace; sessionId?: string }) {
  const { t } = useTranslation()
  const statuses = useAgentSessionStreamStatuses(sessionId ? [sessionId] : [])
  const running = sessionId ? (statuses.get(sessionId)?.isPending ?? false) : false
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground text-sm" title={workspace.path}>
          {workspace.path}
        </span>
        <span className="block text-muted-foreground text-xs">
          {t(running ? 'chat.profile_pane.workspace.running' : 'chat.profile_pane.workspace.idle')}
        </span>
      </span>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FolderOpen className="size-4 text-muted-foreground" />
      </span>
    </>
  )

  return (
    <ProfilePaneSection title={t('chat.profile_pane.workspace.title')}>
      {workspace.open ? (
        <button
          type="button"
          onClick={workspace.open}
          className="flex min-h-12 w-full items-center gap-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {content}
        </button>
      ) : (
        <div className="flex min-h-12 items-center gap-3 py-1.5">{content}</div>
      )}
    </ProfilePaneSection>
  )
}
