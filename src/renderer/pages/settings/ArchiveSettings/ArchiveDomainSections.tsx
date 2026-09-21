import { chunk } from 'es-toolkit'
import { ListTodo, MessageSquare } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import useSWR from 'swr'

import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { renderAgentEntityIcon, renderAssistantEntityIcon } from '@renderer/components/chat/resourceList/base'
import {
  useDataChange,
  useInfiniteFlatItems,
  useInfiniteQuery,
  usePaginatedQuery
} from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toFileUrl } from '@shared/utils/file'

import type { ArchiveItem } from './archive'
import { toEpochMs } from './archive'
import ArchiveSection, { type PendingPermanentDelete } from './ArchiveSection'
import {
  useTopicArchiveActions,
  useAgentArchiveActions,
  useSessionArchiveActions,
  useAssistantArchiveActions,
  usePaintingArchiveActions,
  useFileArchiveActions
} from './useArchiveActions'

const logger = loggerService.withContext('ArchiveDomainSections')

const ARCHIVED_ITEMS_QUERY = { inTrash: true } as const
const PREVIEW_BATCH_SIZE = 500

export interface ArchiveDomainSectionProps {
  retentionDays: number
  batchToolbarContainer?: HTMLDivElement | null
  isBatchMode: boolean
  onBatchAvailabilityChange?: (available: boolean) => void
  isPermanentDeleting: boolean
  onRequestDelete: (request: PendingPermanentDelete) => void
}

export const TopicArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/topics', {
    query: ARCHIVED_ITEMS_QUERY,
    limit: 50
  })
  const topics = useInfiniteFlatItems(pages)
  useDataChange('/topics', () => void refresh())
  const items = useMemo<ArchiveItem[]>(
    () => topics.map((topic) => ({ id: topic.id, name: topic.name, deletedAt: toEpochMs(topic.deletedAt) })),
    [topics]
  )

  const actions = useTopicArchiveActions(refresh)

  return (
    <ArchiveSection
      icon={MessageSquare}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const AgentArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const {
    items: agents,
    total,
    page,
    isLoading,
    error,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    refresh
  } = usePaginatedQuery('/agents', { query: ARCHIVED_ITEMS_QUERY, limit: 50 })
  const [iconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const items = useMemo<ArchiveItem[]>(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name ?? '',
        deletedAt: toEpochMs(agent.deletedAt),
        icon: renderAgentEntityIcon(iconType, agent, defaultModelId, 36)
      })),
    [agents, iconType, defaultModelId]
  )
  const totalPages = Math.ceil(total / 50)
  useDataChange('/agents', () => void refresh())

  const actions = useAgentArchiveActions(refresh)

  return (
    <ArchiveSection
      icon={SIDEBAR_ICON_COMPONENTS.agents}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{
        kind: 'offset',
        page,
        totalPages,
        totalCount: total,
        hasPrev,
        hasNext,
        onPrevPage: prevPage,
        onNextPage: nextPage
      }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const SessionArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    query: ARCHIVED_ITEMS_QUERY,
    limit: 50
  })
  const sessions = useInfiniteFlatItems(pages)
  useDataChange('/agent-sessions', () => void refresh())
  const items = useMemo<ArchiveItem[]>(
    () => sessions.map((session) => ({ id: session.id, name: session.name, deletedAt: toEpochMs(session.deletedAt) })),
    [sessions]
  )

  const actions = useSessionArchiveActions(refresh)

  return (
    <ArchiveSection
      icon={ListTodo}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const AssistantArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const {
    items: assistants,
    total,
    page,
    isLoading,
    error,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    refresh
  } = usePaginatedQuery('/assistants', { query: ARCHIVED_ITEMS_QUERY, limit: 50 })
  const [iconType] = usePreference('assistant.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const items = useMemo<ArchiveItem[]>(
    () =>
      assistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        deletedAt: toEpochMs(assistant.deletedAt),
        icon: renderAssistantEntityIcon(iconType, assistant, defaultModelId, 36)
      })),
    [assistants, iconType, defaultModelId]
  )
  const totalPages = Math.ceil(total / 50)
  useDataChange('/assistants', () => void refresh())

  const actions = useAssistantArchiveActions(refresh)

  return (
    <ArchiveSection
      icon={SIDEBAR_ICON_COMPONENTS.assistants}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{
        kind: 'offset',
        page,
        totalPages,
        totalCount: total,
        hasPrev,
        hasNext,
        onPrevPage: prevPage,
        onNextPage: nextPage
      }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const PaintingArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/paintings', {
    query: ARCHIVED_ITEMS_QUERY,
    limit: 50
  })
  const paintings = useInfiniteFlatItems(pages)
  useDataChange('/paintings', () => void refresh())
  const previewIds = [...new Set(paintings.flatMap((painting) => painting.files.output.slice(0, 1)))]
  const { data: previewPaths } = useSWR(
    previewIds.length > 0 ? (['archive-painting-previews', previewIds] as const) : null,
    async ([, ids]) => {
      const batches = await Promise.all(
        chunk(ids, PREVIEW_BATCH_SIZE).map((batch) => ipcApi.request('file.batch_get_physical_paths', { ids: batch }))
      )
      return Object.assign({}, ...batches) as (typeof batches)[number]
    },
    { onError: (error) => logger.warn('Failed to load archived painting previews', error) }
  )
  const PaintingIcon = SIDEBAR_ICON_COMPONENTS.paintings
  const items = useMemo<ArchiveItem[]>(
    () =>
      paintings.map((painting) => {
        const path = previewPaths?.[painting.files.output[0]]
        return {
          id: painting.id,
          name: painting.prompt,
          deletedAt: toEpochMs(painting.deletedAt),
          icon: (
            <Avatar className="size-9 rounded-lg">
              <AvatarImage src={path ? toFileUrl(path) : undefined} alt="" draggable={false} className="object-cover" />
              <AvatarFallback className="rounded-lg bg-muted text-muted-foreground">
                <PaintingIcon size={18} />
              </AvatarFallback>
            </Avatar>
          )
        }
      }),
    [paintings, previewPaths, PaintingIcon]
  )

  const actions = usePaintingArchiveActions(refresh)

  return (
    <ArchiveSection
      icon={SIDEBAR_ICON_COMPONENTS.paintings}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const FileArchiveSection: FC<ArchiveDomainSectionProps> = ({
  retentionDays,
  batchToolbarContainer,
  isBatchMode,
  onBatchAvailabilityChange,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/files/entries', {
    query: ARCHIVED_ITEMS_QUERY,
    limit: 50
  })
  const entries = useInfiniteFlatItems(pages)
  useDataChange('/files/entries', () => void refresh())
  const items = useMemo<ArchiveItem[]>(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        name: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
        deletedAt: toEpochMs(entry.origin === 'internal' ? entry.deletedAt : undefined)
      })),
    [entries]
  )

  const actions = useFileArchiveActions()

  return (
    <ArchiveSection
      icon={SIDEBAR_ICON_COMPONENTS.files}
      batchToolbarContainer={batchToolbarContainer}
      isBatchMode={isBatchMode}
      onBatchAvailabilityChange={onBatchAvailabilityChange}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      isPermanentDeleting={isPermanentDeleting}
      {...actions}
      onRequestDelete={onRequestDelete}
      includeFileReferencePreview
    />
  )
}
