import { loggerService } from '@logger'
import {
  useDataChange,
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  usePaginatedQuery
} from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
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

/**
 * The batch file routes resolve with per-id outcomes instead of rejecting, so a
 * failure would otherwise be toasted as success. Turn it back into a throw.
 */
function throwOnBatchFailure(result: { failed: Array<{ id: string; error: string }> }): void {
  const [failure] = result.failed
  if (failure) throw new Error(failure.error)
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
      toast.success(messages.success)
    } catch (error) {
      logger.error(`trash ${action} failed`, error as Error)
      toast.error(messages.error)
    }
  }
}

export const TopicTrashSection: FC<TrashDomainSectionProps> = ({ retentionDays, onRequestDelete }) => {
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/topics', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const topics = useInfiniteFlatItems(pages)
  useDataChange('/topics', () => void refresh())
  const items = useMemo<TrashItem[]>(
    () => topics.map((topic) => ({ id: topic.id, name: topic.name, deletedAt: toEpochMs(topic.deletedAt) })),
    [topics]
  )

  // Refresh the list plus the one restored row — `/topics/*` would revalidate every cached topic.
  const restoreMutation = useMutation('POST', '/topics/:id/restore', {
    refresh: ({ args }) => ['/topics', `/topics/${args!.params.id}`]
  })
  // Purge refreshes the list only — revalidating `/topics/:id` would fetch a row that is
  // gone and cache the 404 in SWR.
  const deleteMutation = useMutation('DELETE', '/topics/:id', { refresh: ['/topics'] })

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
  const runAction = useTrashActionRunner()
  const invalidate = useInvalidateCache()
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
  useDataChange('/agents', () => void refresh())

  // `/agent-sessions` too: restoring an agent also restores the sessions archived with
  // it, and a stale session-trash row would still offer a purge that hard-deletes a live one.
  const restoreMutation = useMutation('POST', '/agents/:agentId/restore', {
    refresh: ({ args }) => ['/agents', `/agents/${args!.params.agentId}`, '/agent-sessions']
  })

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
      runAction('permanent_delete', async () => {
        await ipcApi.request('ai.agent.delete', {
          agentId: target.id,
          deleteSessions: false,
          permanent: true
        })
        // Retained sessions lose their agent id, so their rows move too.
        await invalidate(['/agents', '/agent-sessions'])
      })
    )

  return (
    <TrashSection
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
  const runAction = useTrashActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const sessions = useInfiniteFlatItems(pages)
  useDataChange('/agent-sessions', () => void refresh())
  const items = useMemo<TrashItem[]>(
    () => sessions.map((session) => ({ id: session.id, name: session.name, deletedAt: toEpochMs(session.deletedAt) })),
    [sessions]
  )

  const restoreMutation = useMutation('POST', '/agent-sessions/:sessionId/restore', {
    refresh: ({ args }) => ['/agent-sessions', `/agent-sessions/${args!.params.sessionId}`, '/agents/*']
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
      runAction('permanent_delete', async () => {
        await ipcApi.request('ai.agent.session.delete', { sessionIds: [target.id], permanent: true })
        // `/agents/*` stays: the parent agent survives and its session counts change.
        await invalidate(['/agent-sessions', '/agents/*'])
      })
    )

  return (
    <TrashSection
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
  useDataChange('/assistants', () => void refresh())

  const restoreMutation = useMutation('POST', '/assistants/:id/restore', {
    refresh: ({ args }) => ['/assistants', `/assistants/${args!.params.id}`]
  })
  const deleteMutation = useMutation('DELETE', '/assistants/:id', { refresh: ['/assistants'] })

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
  const runAction = useTrashActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/paintings', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const paintings = useInfiniteFlatItems(pages)
  useDataChange('/paintings', () => void refresh())
  const items = useMemo<TrashItem[]>(
    () =>
      paintings.map((painting) => ({
        id: painting.id,
        name: painting.prompt,
        deletedAt: toEpochMs(painting.deletedAt)
      })),
    [paintings]
  )

  const restoreMutation = useMutation('POST', '/paintings/:id/restore', {
    refresh: ({ args }) => ['/paintings', `/paintings/${args!.params.id}`]
  })
  const deleteMutation = useMutation('DELETE', '/paintings/:id', { refresh: ['/paintings'] })

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
  const runAction = useTrashActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/files/entries', {
    query: IN_TRASH_QUERY,
    limit: 20
  })
  const entries = useInfiniteFlatItems(pages)
  useDataChange('/files/entries', () => void refresh())
  const items = useMemo<TrashItem[]>(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        name: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
        deletedAt: toEpochMs(entry.origin === 'internal' ? entry.deletedAt : undefined)
      })),
    [entries]
  )

  // Files DataApi is read-only — restore/purge go through File IPC. Purge skips the by-id
  // paths: the entry is gone and revalidating it would cache the 404.
  const invalidateFiles = () => invalidate(['/files/entries', '/files/entries/*'])
  const invalidatePurgedFiles = () => invalidate(['/files/entries'])

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', async () => {
        throwOnBatchFailure(await ipcApi.request('file.batch_restore', { ids: [item.id] }))
        await invalidateFiles()
      })
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) =>
    onRequestDelete(item, (target) =>
      runAction('permanent_delete', async () => {
        throwOnBatchFailure(await ipcApi.request('file.batch_permanent_delete_from_trash', { ids: [target.id] }))
        await invalidatePurgedFiles()
      })
    )

  return (
    <TrashSection
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
