import { arrayMove } from '@dnd-kit/helpers'
import { Archive, SquarePen } from 'lucide-react'
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea, Skeleton } from '@cherrystudio/ui'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { renderAgentEntityIcon } from '@renderer/components/chat/resourceList/base'
import { useAgentRemoval } from '@renderer/components/chat/resourceList/useAgentRemoval'
import { useOwnerResourceActivation } from '@renderer/components/chat/resourceList/useOwnerResourceActivation'
import { CommandContextMenu } from '@renderer/components/command'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { SidebarSortableList } from '@renderer/components/Sidebar'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useAgentSessionHistoryQuery } from '@renderer/hooks/useAgentSessionParts'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { toast } from '@renderer/services/toast'
import { compareResourceOrderKey } from '@renderer/utils/chat/resourceListBase'
import { markdownToPlainText } from '@renderer/utils/markdown'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { applyOptimisticOrder } from '@renderer/utils/resourceEntity'
import { cn } from '@renderer/utils/style'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { type AgentEntity, AgentTypeSchema } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

const logger = loggerService.withContext('MinimalAgentList')
const sessionMessagesPath = '/agent-sessions/:sessionId/messages'

function AgentResultPreview({ id, sessionId, enabled }: { id: string; sessionId?: string; enabled: boolean }) {
  const { t } = useTranslation()
  const params = { sessionId: sessionId ?? '' }
  const canReadPreview = enabled && !!sessionId
  const { data, isLoading, refetch } = useQuery(sessionMessagesPath, {
    enabled: canReadPreview,
    params,
    query: { limit: 20, deferToolOutputs: true },
    swrOptions: { keepPreviousData: !enabled, dedupingInterval: 0 }
  })
  useDataChange(canReadPreview ? sessionMessagesPath : [], () => void refetch(), { routeParams: params })

  let preview = ''
  for (const message of data?.items ?? []) {
    if (message.role !== 'assistant' || message.status !== 'success') continue
    preview = markdownToPlainText(getTextFromParts(message.data.parts ?? []))
      .replace(/\s+/g, ' ')
      .trim()
    if (preview) break
  }

  return (
    <span id={id} className="truncate font-normal text-xs leading-4 text-muted-foreground">
      {preview || t(isLoading ? 'common.loading' : 'minimal.start_chat_prompt')}
    </span>
  )
}

function AgentRowContent({ agent, children }: { agent: AgentEntity; children?: ReactNode }) {
  return (
    <>
      <span className="shrink-0">{renderAgentEntityIcon('emoji', agent, undefined, 32)}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5" title={agent.name}>
          {agent.name}
        </span>
        {children}
      </span>
    </>
  )
}

export function MinimalAgentList({
  source,
  dataEnabled = true,
  activeSessionId,
  onSelect,
  onCreate,
  onActiveAgentDeleted
}: {
  source: Pick<AgentSessionsSource, 'sessions' | 'loadLatestSession' | 'isFullyLoaded' | 'reload'>
  dataEnabled?: boolean
  activeSessionId: string | null
  onSelect: (session: AgentSessionEntity, created: boolean) => void
  onCreate: (agentId: string) => Promise<AgentSessionEntity>
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
}) {
  const { agents, isLoading, error, refetch } = useAgents()
  const { deletingAgentId, handleDeleteAgent } = useAgentRemoval({
    agents,
    activeSessionId,
    source,
    refetchAgents: refetch,
    onActiveAgentDeleted
  })
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  const previewId = useId()
  const [resolvingSession, setResolvingSession] = useState(false)
  const [isReordering, startReorder] = useTransition()
  const [pendingSelection, setPendingSelection] = useState<{
    from: string | null
    session: AgentSessionEntity
  } | null>(null)
  const pendingSession = pendingSelection?.from === activeSessionId ? pendingSelection.session : null
  const { pages, error: historyError } = useAgentSessionHistoryQuery(pendingSession?.id ?? '')
  const canShowSession = pages.length > 0 || !!historyError
  const opening = resolvingSession || !!pendingSession
  const { activateOwnerResource, cancelOwnerResourceActivation } = useOwnerResourceActivation<
    { agentId: string; createOnly: boolean },
    { session: AgentSessionEntity; created: boolean }
  >({
    loadResourceForOwner: async ({ agentId, createOnly }) => {
      if (createOnly) return null
      const session = await source.loadLatestSession(agentId)
      return session ? { session, created: false } : null
    },
    createResourceForOwner: async ({ agentId }) => ({ session: await onCreate(agentId), created: true }),
    onActivateResource: ({ session, created }) => {
      if (created || session.id === activeSessionId) onSelect(session, created)
      else setPendingSelection({ from: activeSessionId, session })
    },
    onError: (error) => {
      logger.error('Failed to open agent conversation', error instanceof Error ? error : { error })
      toast.error(t('agent.session.get.error.failed'))
    }
  })

  // Navigation outside the sidebar can change the selection during an asynchronous lookup.
  useLayoutEffect(() => cancelOwnerResourceActivation, [activeSessionId, cancelOwnerResourceActivation])

  useEffect(() => {
    if (!pendingSelection) return
    if (!pendingSession) {
      setPendingSelection(null)
    } else if (canShowSession) {
      setPendingSelection(null)
      onSelect(pendingSession, false)
    }
  }, [canShowSession, onSelect, pendingSelection, pendingSession])

  // The API puts pinned agents first, but this flat list follows the agents' own order.
  const availableAgents = useMemo(
    () =>
      agents
        .filter((agent) => AgentTypeSchema.safeParse(agent.type).success)
        .sort((a, b) => compareResourceOrderKey(a.orderKey, b.orderKey)),
    [agents]
  )
  const [orderedAgents, setOptimisticOrder] = useOptimistic<typeof availableAgents, string[]>(
    availableAgents,
    applyOptimisticOrder
  )

  const handleReorder = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
    const agent = orderedAgents[oldIndex]
    const target = orderedAgents[newIndex]
    if (!agent || !target || agent.id === target.id || isReordering || opening) return

    const ids = orderedAgents.map(({ id }) => id)
    startReorder(async () => {
      setOptimisticOrder(arrayMove(ids, oldIndex, newIndex))
      try {
        await reorderAgent({
          params: { id: agent.id },
          body: oldIndex < newIndex ? { after: target.id } : { before: target.id }
        })
      } catch (error) {
        logger.error('Failed to reorder minimal agent list', { error })
        toast.error(t('common.save_failed'))
      }
    })
  }

  const activeAgentId = source.sessions.find((session) => session.id === activeSessionId)?.agentId
  const latestSessions = useMemo(() => {
    const latest = new Map<string, AgentSessionEntity>()
    for (const session of source.sessions) {
      if (!session.agentId) continue
      const previous = latest.get(session.agentId)
      if (
        !previous ||
        session.lastActivityAt > previous.lastActivityAt ||
        (session.lastActivityAt === previous.lastActivityAt && session.id < previous.id)
      ) {
        latest.set(session.agentId, session)
      }
    }
    return latest
  }, [source.sessions])
  return (
    <ScrollArea className="min-h-0 flex-1" contentProps={{ className: 'flex flex-col gap-1.5 p-3' }}>
      {isLoading && agents.length === 0 && <Skeleton className="h-11 w-full rounded-lg" />}
      {error && (
        <div role="alert" className="px-3 py-2 text-sm text-muted-foreground">
          <Button variant="ghost" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      <SidebarSortableList
        items={orderedAgents}
        itemKey="id"
        className="gap-1.5"
        disabled={orderedAgents.length < 2 || opening || isReordering || !!error}
        onReorder={handleReorder}
        renderDragOverlay={(agent) => (
          <div aria-hidden className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg bg-sidebar px-2 py-1">
            <AgentRowContent agent={agent} />
          </div>
        )}>
        {(agent, guardClick) => (
          <CommandContextMenu
            key={agent.id}
            location="webcontents.context"
            extraItems={[
              {
                type: 'item',
                id: 'new-task',
                label: t('agent.session.new'),
                icon: <NewConversationIcon />,
                enabled: !opening,
                onSelect: () => void activateOwnerResource({ agentId: agent.id, createOnly: true })
              },
              {
                type: 'item',
                id: 'edit-agent',
                label: t('agent.edit.title'),
                icon: <SquarePen />,
                onSelect: () => openResourceEditDialog({ kind: 'agent', id: agent.id })
              },
              ...(isProtectedBuiltinAgentRole(agent.configuration?.builtin_role)
                ? []
                : [
                    { type: 'separator' as const },
                    {
                      type: 'item' as const,
                      id: 'archive-agent',
                      label: t('common.archive'),
                      icon: <Archive />,
                      enabled: !opening && deletingAgentId === null,
                      onSelect: () => void handleDeleteAgent(agent.id)
                    }
                  ])
            ]}>
            <Button
              type="button"
              data-dnd-row-control
              aria-label={agent.name}
              aria-describedby={`${previewId}-${agent.id}`}
              variant="ghost"
              aria-disabled={opening || undefined}
              aria-pressed={activeAgentId === agent.id}
              className={cn(
                'h-11 w-full min-w-0 justify-start gap-2 rounded-lg px-2 py-1 text-left transition-[color] focus-visible:inset-ring-1 focus-visible:inset-ring-sidebar-ring aria-pressed:font-medium aria-pressed:text-sidebar-accent-foreground',
                isMacTransparentWindow ? 'aria-pressed:bg-accent' : 'aria-pressed:bg-sidebar-accent/50'
              )}
              onClick={guardClick(agent.id, async () => {
                if (opening) return
                setResolvingSession(true)
                try {
                  await activateOwnerResource({ agentId: agent.id, createOnly: false })
                } finally {
                  setResolvingSession(false)
                }
              })}>
              <AgentRowContent agent={agent}>
                <AgentResultPreview
                  id={`${previewId}-${agent.id}`}
                  sessionId={latestSessions.get(agent.id)?.id}
                  enabled={dataEnabled}
                />
              </AgentRowContent>
            </Button>
          </CommandContextMenu>
        )}
      </SidebarSortableList>
    </ScrollArea>
  )
}
