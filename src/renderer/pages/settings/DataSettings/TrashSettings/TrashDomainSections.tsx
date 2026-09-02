import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import {
  useDataChange,
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  usePaginatedQuery
} from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { requestBatchedFileMutation } from '@renderer/services/fileBatchMutation'
import { toast } from '@renderer/services/toast'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TrashSection, { type PendingPermanentDelete } from './TrashSection'
import type { TrashBatchOutcome, TrashItem } from './trashUtils'
import { runPerItem, toEpochMs } from './trashUtils'

const logger = loggerService.withContext('TrashDomainSections')

const IN_TRASH_QUERY = { inTrash: true } as const

export interface TrashDomainSectionProps {
  retentionDays: number
  isPermanentDeleting: boolean
  onRequestDelete: (request: PendingPermanentDelete) => void
}

const ALREADY_ACTIVE = Symbol('already-active')
const NO_LONGER_IN_RECYCLE_BIN = Symbol('no-longer-in-recycle-bin')

async function reconcileNotFound(
  run: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
  activePath: ConcreteApiPaths
) {
  try {
    await run()
    return undefined
  } catch (error) {
    if (!isDataApiNotFoundError(error)) throw error
    await refresh()
    try {
      await dataApiService.get(activePath)
      return ALREADY_ACTIVE
    } catch {
      throw error
    }
  }
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
      const result = await run()
      if (result === NO_LONGER_IN_RECYCLE_BIN) {
        toast.info(t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin'))
      } else {
        toast[action === 'restore' && result === ALREADY_ACTIVE ? 'info' : 'success'](messages.success)
      }
    } catch (error) {
      logger.error(`trash ${action} failed`, error as Error)
      toast.error(messages.error)
    }
  }
}

async function runSinglePermanentDelete(
  item: TrashItem,
  runAction: ReturnType<typeof useTrashActionRunner>,
  run: (items: TrashItem[]) => Promise<TrashBatchOutcome>
): Promise<TrashBatchOutcome> {
  let outcome: TrashBatchOutcome = { succeeded: [], failed: [] }
  await runAction('permanent_delete', async () => {
    outcome = await run([item])
    const [failure] = outcome.failed
    if (failure?.reason === 'no-longer-in-recycle-bin') return NO_LONGER_IN_RECYCLE_BIN
    if (failure) throw new Error(failure.error)
    return undefined
  })
  return outcome
}

async function runDataPermanentDeletes(
  targets: TrashItem[],
  deleteItem: (item: TrashItem) => Promise<unknown>,
  refresh: () => Promise<unknown>,
  staleMessage: string
): Promise<TrashBatchOutcome> {
  const staleIds = new Set<string>()
  const outcome = await runPerItem(targets, async (item) => {
    try {
      await deleteItem(item)
    } catch (error) {
      if (isDataApiNotFoundError(error)) {
        staleIds.add(item.id)
        throw new Error(staleMessage)
      }
      throw error
    }
  })
  try {
    await refresh()
  } catch (error) {
    logger.warn('failed to refresh trash after permanent delete', error as Error)
  }
  return classifyStaleFailures(outcome, staleIds)
}

function classifyStaleFailures(outcome: TrashBatchOutcome, staleIds: ReadonlySet<string>): TrashBatchOutcome {
  return {
    ...outcome,
    failed: outcome.failed.map((failure) =>
      staleIds.has(failure.id) ? { ...failure, reason: 'no-longer-in-recycle-bin' as const } : failure
    )
  }
}

const FILE_DETAIL_LOOKUP_CONCURRENCY = 8

async function findActiveFileIds(failures: TrashBatchOutcome['failed']): Promise<Set<string>> {
  const activeIds = new Set<string>()
  for (let index = 0; index < failures.length; index += FILE_DETAIL_LOOKUP_CONCURRENCY) {
    const chunk = failures.slice(index, index + FILE_DETAIL_LOOKUP_CONCURRENCY)
    await Promise.all(
      chunk.map(async ({ id }) => {
        try {
          const entry = await dataApiService.get(`/files/entries/${id}`)
          if (entry.origin === 'external' || entry.deletedAt == null) activeIds.add(id)
        } catch {
          // Still absent or inaccessible: retain the server failure for retry.
        }
      })
    )
  }
  return activeIds
}

export const TopicTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { t } = useTranslation()
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
  const deleteMutation = useMutation('DELETE', '/topics/:id')

  const restoreItem = (item: TrashItem) =>
    reconcileNotFound(() => restoreMutation.trigger({ params: { id: item.id } }), refresh, `/topics/${item.id}`)

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: TrashItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = (targets: TrashItem[]) =>
    runDataPermanentDeletes(
      targets,
      (target) => deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } }),
      refresh,
      t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    )
  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return (
    <TrashSection
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={handleRestoreMany}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={handleDeleteMany}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const AgentTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { t } = useTranslation()
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

  const restoreItem = (item: TrashItem) =>
    reconcileNotFound(() => restoreMutation.trigger({ params: { agentId: item.id } }), refresh, `/agents/${item.id}`)

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: TrashItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = async (targets: TrashItem[]) => {
    const staleIds = new Set<string>()
    const staleMessage = t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    const outcome = await runPerItem(targets, async (target) => {
      const result = await ipcApi.request('ai.agent.delete', {
        agentId: target.id,
        deleteSessions: false,
        permanent: true
      })
      if (!result.deleted) {
        staleIds.add(target.id)
        throw new Error(staleMessage)
      }
    })
    // Retained sessions lose their agent id, so their rows move too.
    try {
      await invalidate(['/agents', '/agent-sessions'])
    } catch (error) {
      logger.warn('failed to refresh agents after permanent delete', error as Error)
    }
    return classifyStaleFailures(outcome, staleIds)
  }
  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

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
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={handleRestoreMany}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={handleDeleteMany}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const SessionTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { t } = useTranslation()
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

  const restoreItem = (item: TrashItem) =>
    reconcileNotFound(
      () => restoreMutation.trigger({ params: { sessionId: item.id } }),
      refresh,
      `/agent-sessions/${item.id}`
    )

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: TrashItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = async (targets: TrashItem[]) => {
    const staleIds = new Set<string>()
    const staleMessage = t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    const outcome = await runPerItem(targets, async (target) => {
      const result = await ipcApi.request('ai.agent.session.delete', { sessionIds: [target.id], permanent: true })
      if (!result.deletedIds.includes(target.id)) {
        staleIds.add(target.id)
        throw new Error(staleMessage)
      }
    })
    // `/agents/*` stays: the parent agent survives and its session counts change.
    try {
      await invalidate(['/agent-sessions', '/agents/*'])
    } catch (error) {
      logger.warn('failed to refresh sessions after permanent delete', error as Error)
    }
    return classifyStaleFailures(outcome, staleIds)
  }
  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return (
    <TrashSection
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={handleRestoreMany}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={handleDeleteMany}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const AssistantTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
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
  useDataChange('/assistants', () => void refresh())

  const restoreMutation = useMutation('POST', '/assistants/:id/restore', {
    refresh: ({ args }) => ['/assistants', `/assistants/${args!.params.id}`]
  })
  const deleteMutation = useMutation('DELETE', '/assistants/:id')

  const restoreItem = (item: TrashItem) =>
    reconcileNotFound(() => restoreMutation.trigger({ params: { id: item.id } }), refresh, `/assistants/${item.id}`)

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: TrashItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = (targets: TrashItem[]) =>
    runDataPermanentDeletes(
      targets,
      (target) => deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } }),
      refresh,
      t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    )
  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

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
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={handleRestoreMany}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={handleDeleteMany}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const PaintingTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { t } = useTranslation()
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
  const deleteMutation = useMutation('DELETE', '/paintings/:id')

  const restoreItem = (item: TrashItem) =>
    reconcileNotFound(() => restoreMutation.trigger({ params: { id: item.id } }), refresh, `/paintings/${item.id}`)

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: TrashItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = (targets: TrashItem[]) =>
    runDataPermanentDeletes(
      targets,
      (target) => deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } }),
      refresh,
      t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    )
  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return (
    <TrashSection
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={handleRestoreMany}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={handleDeleteMany}
      onRequestDelete={onRequestDelete}
    />
  )
}

export const FileTrashSection: FC<TrashDomainSectionProps> = ({
  retentionDays,
  isPermanentDeleting,
  onRequestDelete
}) => {
  const { t } = useTranslation()
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

  const restoreItems = async (targets: TrashItem[]): Promise<TrashBatchOutcome> => {
    const result = await requestBatchedFileMutation(
      'file.batch_restore',
      targets.map((item) => item.id)
    )
    const outcome: TrashBatchOutcome = { succeeded: result.succeeded, failed: result.failed }
    try {
      await invalidateFiles()
    } catch (error) {
      logger.warn('failed to refresh files after restore', error as Error)
    }
    const activeAfterFailure = await findActiveFileIds(outcome.failed)
    if (activeAfterFailure.size === 0) return outcome
    return {
      succeeded: [...outcome.succeeded, ...activeAfterFailure],
      failed: outcome.failed.filter(({ id }) => !activeAfterFailure.has(id))
    }
  }

  const deleteItems = async (targets: TrashItem[]): Promise<TrashBatchOutcome> => {
    const result = await requestBatchedFileMutation(
      'file.batch_permanent_delete_from_trash',
      targets.map((item) => item.id)
    )
    const outcome: TrashBatchOutcome = { succeeded: result.succeeded, failed: result.failed }
    try {
      await invalidatePurgedFiles()
    } catch (error) {
      logger.warn('failed to refresh files after permanent delete', error as Error)
    }
    const activeAfterFailure = await findActiveFileIds(outcome.failed)
    if (activeAfterFailure.size === 0) return outcome
    const staleMessage = t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    return classifyStaleFailures(
      {
        ...outcome,
        failed: outcome.failed.map((failure) =>
          activeAfterFailure.has(failure.id) ? { ...failure, error: staleMessage } : failure
        )
      },
      activeAfterFailure
    )
  }

  const handleRestore = async (item: TrashItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', async () => {
        const outcome = await restoreItems([item])
        const [failure] = outcome.failed
        if (failure) throw new Error(failure.error)
      })
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleDelete = (item: TrashItem) => runSinglePermanentDelete(item, runAction, deleteItems)

  return (
    <TrashSection
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      retentionDays={retentionDays}
      pendingRestoreId={pendingRestoreId}
      isPermanentDeleting={isPermanentDeleting}
      onRestore={handleRestore}
      onRestoreMany={restoreItems}
      onPermanentDelete={handleDelete}
      onPermanentDeleteMany={deleteItems}
      onRequestDelete={onRequestDelete}
      includeFileReferencePreview
    />
  )
}
