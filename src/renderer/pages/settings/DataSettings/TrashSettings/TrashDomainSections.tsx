import { loggerService } from '@logger'
import {
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  usePaginatedQuery
} from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TrashSection from './TrashSection'
import type { TrashItem } from './trashUtils'
import { toEpochMs } from './trashUtils'

const logger = loggerService.withContext('TrashDomainSections')

const IN_TRASH_QUERY = { inTrash: true } as const

export interface TrashDomainSectionProps {
  retentionDays: number
  onRequestDelete: (item: TrashItem, deleteItem: (item: TrashItem) => Promise<void>) => void
}

/** Shared toast + logging around a restore/delete mutation. */
function useTrashActionRunner() {
  const { t } = useTranslation()

  return async (action: 'restore' | 'permanent_delete', run: () => Promise<unknown>): Promise<void> => {
    const messages =
      action === 'restore'
        ? { success: t('settings.data.trash.restore.success'), error: t('settings.data.trash.restore.error') }
        : {
            success: t('settings.data.trash.permanent_delete.success'),
            error: t('settings.data.trash.permanent_delete.error')
          }
    try {
      await run()
      window.toast.success(messages.success)
    } catch (error) {
      logger.error(`trash ${action} failed`, error as Error)
      window.toast.error(messages.error)
    }
  }
}

export const TopicTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/topics', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const topics = useInfiniteFlatItems(pages)
  const items = useMemo<TrashItem[]>(
    () => topics.map((topic) => ({ id: topic.id, name: topic.name, deletedAt: toEpochMs(topic.deletedAt) })),
    [topics]
  )

  const restoreMutation = useMutation('POST', '/topics/:id/restore', { refresh: ['/topics', '/topics/*'] })
  const deleteMutation = useMutation('DELETE', '/topics/:id', { refresh: ['/topics', '/topics/*'] })

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreMutation.trigger({ params: { id: item.id } }))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', () =>
        deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } })
      )
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.topics')}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}

export const AgentTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

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
  } = usePaginatedQuery('/agents', { query: IN_TRASH_QUERY, limit: 50 })
  const items = useMemo<TrashItem[]>(
    () => agents.map((agent) => ({ id: agent.id, name: agent.name ?? '', deletedAt: toEpochMs(agent.deletedAt) })),
    [agents]
  )
  const totalPages = Math.ceil(total / 50)

  const restoreMutation = useMutation('POST', '/agents/:agentId/restore', { refresh: ['/agents', '/agents/*'] })
  const deleteMutation = useMutation('DELETE', '/agents/:agentId', { refresh: ['/agents', '/agents/*'] })

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreMutation.trigger({ params: { agentId: item.id } }))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', () =>
        deleteMutation.trigger({ params: { agentId: target.id }, query: { permanent: true } })
      )
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.agents')}
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
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}

export const SessionTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const sessions = useInfiniteFlatItems(pages)
  const items = useMemo<TrashItem[]>(
    () => sessions.map((session) => ({ id: session.id, name: session.name, deletedAt: toEpochMs(session.deletedAt) })),
    [sessions]
  )

  const restoreMutation = useMutation('POST', '/agent-sessions/:sessionId/restore', {
    refresh: ['/agent-sessions', '/agent-sessions/*', '/agents/*']
  })
  const deleteMutation = useMutation('DELETE', '/agent-sessions/:sessionId', {
    refresh: ['/agent-sessions', '/agent-sessions/*', '/agents/*']
  })

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreMutation.trigger({ params: { sessionId: item.id } }))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', () =>
        deleteMutation.trigger({ params: { sessionId: target.id }, query: { permanent: true } })
      )
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.sessions')}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}

export const AssistantTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

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
  } = usePaginatedQuery('/assistants', { query: IN_TRASH_QUERY, limit: 50 })
  const items = useMemo<TrashItem[]>(
    () =>
      assistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        deletedAt: toEpochMs(assistant.deletedAt)
      })),
    [assistants]
  )
  const totalPages = Math.ceil(total / 50)

  const restoreMutation = useMutation('POST', '/assistants/:id/restore', {
    refresh: ['/assistants', '/assistants/*']
  })
  const deleteMutation = useMutation('DELETE', '/assistants/:id', { refresh: ['/assistants', '/assistants/*'] })

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreMutation.trigger({ params: { id: item.id } }))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', () =>
        deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } })
      )
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.assistants')}
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
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}

export const PaintingTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/paintings', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const paintings = useInfiniteFlatItems(pages)
  const items = useMemo<TrashItem[]>(
    () =>
      paintings.map((painting) => ({
        id: painting.id,
        name: painting.prompt,
        deletedAt: toEpochMs(painting.deletedAt)
      })),
    [paintings]
  )

  const restoreMutation = useMutation('POST', '/paintings/:id/restore', { refresh: ['/paintings', '/paintings/*'] })
  const deleteMutation = useMutation('DELETE', '/paintings/:id', { refresh: ['/paintings', '/paintings/*'] })

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreMutation.trigger({ params: { id: item.id } }))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', () =>
        deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } })
      )
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.paintings')}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}

export const FileTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const { t } = useTranslation()
  const runAction = useTrashActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/files/entries', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const entries = useInfiniteFlatItems(pages)
  const items = useMemo<TrashItem[]>(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        name: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
        deletedAt: toEpochMs(entry.origin === 'internal' ? entry.deletedAt : undefined)
      })),
    [entries]
  )

  // Files DataApi is read-only — restore/purge go through File IPC.
  const invalidateFiles = () => invalidate(['/files/entries', '/files/entries/*'])

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', async () => {
        await ipcApi.request('file.batch_restore', { ids: [item.id] })
        await invalidateFiles()
      })
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', async () => {
        await ipcApi.request('file.batch_permanent_delete', { ids: [target.id] })
        await invalidateFiles()
      })
    )

  return (
    <TrashSection
      title={t('settings.data.trash.domain.files')}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  )
}
