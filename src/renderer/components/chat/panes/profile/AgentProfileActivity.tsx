import { Clock, Database, FolderOpen, GitBranch, MessageSquare, Sparkles, Zap } from 'lucide-react'
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
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { ProfileStarter, ProfileStarterKind } from '@shared/data/cache/cacheValueTypes'
import type { AgentEntity, ScheduledTaskEntity } from '@shared/data/types/agent'
import type { AgentTaskPatch } from '@shared/ipc/schemas/ai'

import {
  ProfilePaneSection,
  ProfilePaneSectionAction,
  type ProfileStarterCard,
  ProfileStartersSection
} from './ProfilePaneParts'
import { ProfileStatTiles } from './ProfilePaneStats'
import { useProfileStarters } from './useProfileStarters'

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
  const {
    data: taskPage,
    isLoading: tasksLoading,
    refetch: refetchTasks
  } = useQuery('/agents/:agentId/tasks', {
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
      <AgentUsage agentId={agent.id} />
      <ScheduledTasksSection agent={agent} tasks={tasks} onFillComposer={fillComposer} />
      <SuggestionsSection agent={agent} tasks={tasks} tasksLoading={tasksLoading} onFillComposer={fillComposer} />
      {workspace ? <WorkspaceSection workspace={workspace} sessionId={sessionId} /> : null}
    </>
  )
}

function AgentUsage({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const { data: stats, refetch } = useQuery('/agents/:agentId/stats', { params: { agentId } })
  useDataChange('/agent-sessions', () => void refetch())
  useDataChange('/agent-tasks', () => void refetch())
  useDataChange('/ai-usage-records', () => void refetch())
  if (!stats) return null

  return (
    <ProfileStatTiles
      stats={[
        { label: t('chat.profile_pane.stats.sessions'), value: stats.sessionCount },
        { label: t('chat.profile_pane.stats.task_runs'), value: stats.recentTaskRunCount },
        { label: t('chat.profile_pane.stats.recent_tokens'), value: stats.recentTokens }
      ]}
    />
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

/** Today's rule-based list, shown when nothing could be generated. */
const FALLBACK_SUGGESTIONS: { id: SuggestionId; kind: ProfileStarterKind }[] = [
  { id: 'feishu', kind: 'channel-feishu' },
  { id: 'wechat', kind: 'channel-wechat' },
  { id: 'daily', kind: 'schedule' },
  { id: 'github', kind: 'github' },
  { id: 'skills', kind: 'skills' },
  { id: 'memory', kind: 'memory' },
  { id: 'knowledge', kind: 'knowledge' }
]

const KIND_ICONS: Record<Exclude<ProfileStarterKind, 'channel-feishu' | 'channel-wechat'>, typeof Clock> = {
  schedule: Clock,
  github: GitBranch,
  skills: Zap,
  memory: Sparkles,
  knowledge: Database,
  generic: MessageSquare
}

function SuggestionIcon({ kind }: { kind: ProfileStarterKind }) {
  if (kind === 'channel-feishu' || kind === 'channel-wechat') {
    return (
      <img
        src={getChannelTypeIcon(kind.slice('channel-'.length))}
        alt=""
        className="size-4 rounded-sm object-contain"
      />
    )
  }
  const Icon = KIND_ICONS[kind]
  return <Icon className="size-4 text-muted-foreground" />
}

const listOrNone = (items: string[]) => (items.length ? items.join(', ') : 'none')

function SuggestionsSection({
  agent,
  tasks,
  tasksLoading,
  onFillComposer
}: {
  agent: AgentEntity
  tasks: ScheduledTaskEntity[]
  tasksLoading: boolean
  onFillComposer?: (text: string) => void
}) {
  const { t } = useTranslation()
  const caps = AGENT_RUNTIME_CAPABILITIES[agent.type]
  const knowledgeBaseIds = agent.knowledgeBaseIds ?? []
  const { data: channels, isLoading: channelsLoading } = useQuery('/agent-channels', { query: { agentId: agent.id } })
  const { mcpServers, isLoading: mcpLoading } = useMcpServers(undefined, { enabled: caps.mcp })
  const { skills, loading: skillsLoading } = useInstalledSkills(agent.id, { enabled: caps.skills })
  const { bases, isLoading: basesLoading } = useKnowledgeBases({ enabled: knowledgeBaseIds.length > 0 })
  const linkedServerIds = new Set(agent.mcps ?? [])
  const linkedServers = mcpServers.filter((server) => linkedServerIds.has(server.id))
  const githubLinked = linkedServers.some((server) => GITHUB_PATTERN.test(server.name))
  const setup = [
    `Connected channels: ${listOrNone((channels ?? []).map((channel) => channel.type))}`,
    `Scheduled tasks: ${listOrNone(tasks.map((task) => task.name))}`,
    caps.mcp ? `Linked MCP servers: ${listOrNone(linkedServers.map((server) => server.name))}` : 'MCP: not supported',
    caps.knowledgeBases
      ? `Linked knowledge bases: ${listOrNone(bases.filter((base) => knowledgeBaseIds.includes(base.id)).map((base) => base.name))}`
      : 'Knowledge bases: not supported',
    caps.skills
      ? `Enabled skills: ${listOrNone(skills.filter((skill) => skill.isEnabled).map((skill) => skill.name))}`
      : 'Skills: not supported'
  ].join('\n')
  const starters = useProfileStarters({
    ownerId: agent.id,
    mode: 'agent',
    identity: { name: agent.name, description: agent.description, prompt: agent.instructions },
    context: setup,
    ready: !tasksLoading && !channelsLoading && !mcpLoading && !skillsLoading && !basesLoading,
    enabled: !!onFillComposer
  })

  if (starters.hidden) return null

  // Only what is not done yet; the same rules apply to generated and fallback suggestions.
  const isOpen: Record<ProfileStarterKind, boolean> = {
    'channel-feishu': !channels?.length,
    'channel-wechat': !channels?.some((channel) => channel.type === 'wechat'),
    schedule: !tasks.length,
    github: caps.mcp && !githubLinked,
    skills: caps.skills,
    memory: true,
    knowledge: caps.knowledgeBases && !knowledgeBaseIds.length,
    generic: true
  }
  const items: ProfileStarter[] =
    starters.status === 'unavailable'
      ? FALLBACK_SUGGESTIONS.map(({ id, kind }) => {
          const copy: { label: string; hint: string; prompt?: string } = SUGGESTION_COPY[id]
          return { kind, title: t(copy.label), hint: t(copy.hint), prompt: copy.prompt ? t(copy.prompt) : '' }
        })
      : starters.items
  const cards: ProfileStarterCard[] = items.flatMap((item, index) => {
    if (!isOpen[item.kind]) return []
    // Linking a knowledge base happens in the edit dialog; everything else is asked in this conversation.
    const run =
      item.kind === 'knowledge'
        ? () => openResourceEditDialog({ kind: 'agent', id: agent.id, initialTab: 'tools.knowledge' })
        : onFillComposer && (() => onFillComposer(item.prompt))
    if (!run) return []
    return [
      {
        key: `${item.kind}-${index}`,
        icon: <SuggestionIcon kind={item.kind} />,
        title: item.title,
        hint: item.hint,
        onClick: run
      }
    ]
  })
  const loading = starters.status === 'loading'
  if (!loading && !cards.length) return null

  return (
    <ProfileStartersSection
      title={t('chat.profile_pane.suggestions.title')}
      hideLabel={t('chat.profile_pane.suggestions.hide')}
      loading={loading}
      cards={cards}
      onHide={starters.hide}
    />
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
