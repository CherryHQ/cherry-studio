import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation, useWriteCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { requestBatchedFileMutation } from '@renderer/services/fileBatchMutation'
import { toast } from '@renderer/services/toast'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import { isAgentNotFoundError, isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'

import type { ArchiveBatchOutcome, ArchiveItem } from './archive'
import { runPerItem } from './archive'

const logger = loggerService.withContext('ArchiveActions')

const ALREADY_ACTIVE = Symbol('already-active')
const NO_LONGER_IN_RECYCLE_BIN = Symbol('no-longer-in-recycle-bin')

async function reconcileNotFound(
  run: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
  activePath: ConcreteApiPaths,
  isNotFound: (error: unknown) => boolean = isDataApiNotFoundError
) {
  try {
    await run()
    return undefined
  } catch (error) {
    if (!isNotFound(error)) throw error
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
function useArchiveActionRunner() {
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
  item: ArchiveItem,
  runAction: ReturnType<typeof useArchiveActionRunner>,
  run: (items: ArchiveItem[]) => Promise<ArchiveBatchOutcome>
): Promise<ArchiveBatchOutcome> {
  let outcome: ArchiveBatchOutcome = { succeeded: [], failed: [] }
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
  targets: ArchiveItem[],
  deleteItem: (item: ArchiveItem) => Promise<unknown>,
  refresh: () => Promise<unknown>,
  staleMessage: string
): Promise<ArchiveBatchOutcome> {
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

function classifyStaleFailures(outcome: ArchiveBatchOutcome, staleIds: ReadonlySet<string>): ArchiveBatchOutcome {
  return {
    ...outcome,
    failed: outcome.failed.map((failure) =>
      staleIds.has(failure.id) ? { ...failure, reason: 'no-longer-in-recycle-bin' as const } : failure
    )
  }
}

const FILE_DETAIL_LOOKUP_CONCURRENCY = 8

async function inspectFailedFileIds(
  failures: ArchiveBatchOutcome['failed']
): Promise<{ activeIds: Set<string>; missingIds: Set<string> }> {
  const activeIds = new Set<string>()
  const missingIds = new Set<string>()
  for (let index = 0; index < failures.length; index += FILE_DETAIL_LOOKUP_CONCURRENCY) {
    const chunk = failures.slice(index, index + FILE_DETAIL_LOOKUP_CONCURRENCY)
    await Promise.all(
      chunk.map(async ({ id }) => {
        try {
          const entry = await dataApiService.get(`/files/entries/${id}`)
          if (entry.origin === 'external' || entry.deletedAt == null) activeIds.add(id)
        } catch (error) {
          if (isDataApiNotFoundError(error)) missingIds.add(id)
        }
      })
    )
  }
  return { activeIds, missingIds }
}

function useDataArchiveActions(domain: 'topics' | 'assistants' | 'paintings', refresh: () => Promise<unknown>) {
  const { t } = useTranslation()
  const runAction = useArchiveActionRunner()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  // Refresh only the restored row and list, avoiding every cached detail in the domain.
  const restoreMutation = useMutation('POST', `/${domain}/:id/restore`, {
    refresh: ({ args }) => [`/${domain}`, `/${domain}/${args!.params.id}`]
  })
  const deleteMutation = useMutation('DELETE', `/${domain}/:id`)

  const restoreItem = (item: ArchiveItem) =>
    reconcileNotFound(() => restoreMutation.trigger({ params: { id: item.id } }), refresh, `/${domain}/${item.id}`)

  const handleRestore = async (item: ArchiveItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: ArchiveItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = (targets: ArchiveItem[]) =>
    runDataPermanentDeletes(
      targets,
      (target) => deleteMutation.trigger({ params: { id: target.id }, query: { permanent: true } }),
      refresh,
      t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    )
  const handleDelete = (item: ArchiveItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return {
    pendingRestoreId,
    onRestore: handleRestore,
    onRestoreMany: handleRestoreMany,
    onPermanentDelete: handleDelete,
    onPermanentDeleteMany: handleDeleteMany
  }
}

export function useTopicArchiveActions(refresh: () => Promise<unknown>) {
  return useDataArchiveActions('topics', refresh)
}

export function useAgentArchiveActions(refresh: () => Promise<unknown>) {
  const { t } = useTranslation()
  const runAction = useArchiveActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const restoreItem = (item: ArchiveItem) =>
    reconcileNotFound(
      async () => {
        const restored = await ipcApi.request('ai.agent.restore', { agentId: item.id })
        try {
          await invalidate(['/agents', `/agents/${item.id}`])
        } catch (error) {
          logger.warn('failed to refresh agents after restore', error as Error)
        }
        return restored
      },
      refresh,
      `/agents/${item.id}`,
      isAgentNotFoundError
    )

  const handleRestore = async (item: ArchiveItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: ArchiveItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = async (targets: ArchiveItem[]) => {
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
  const handleDelete = (item: ArchiveItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return {
    pendingRestoreId,
    onRestore: handleRestore,
    onRestoreMany: handleRestoreMany,
    onPermanentDelete: handleDelete,
    onPermanentDeleteMany: handleDeleteMany
  }
}

export function useSessionArchiveActions(refresh: () => Promise<unknown>) {
  const writeCache = useWriteCache()
  const { t } = useTranslation()
  const runAction = useArchiveActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  const restoreItem = (item: ArchiveItem) =>
    reconcileNotFound(
      async () => {
        const restored = await ipcApi.request('ai.agent.session.restore', { sessionId: item.id })
        try {
          await writeCache(`/agent-sessions/${item.id}`, restored)
          await invalidate(['/agent-sessions', `/agent-sessions/${item.id}`, '/agents/*'])
        } catch (error) {
          logger.warn('failed to refresh sessions after restore', error as Error)
        }
        return restored
      },
      refresh,
      `/agent-sessions/${item.id}`,
      isAgentSessionNotFoundError
    )

  const handleRestore = async (item: ArchiveItem) => {
    setPendingRestoreId(item.id)
    try {
      await runAction('restore', () => restoreItem(item))
    } finally {
      setPendingRestoreId(null)
    }
  }

  const handleRestoreMany = (targets: ArchiveItem[]) => runPerItem(targets, restoreItem)
  const handleDeleteMany = async (targets: ArchiveItem[]) => {
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
  const handleDelete = (item: ArchiveItem) => runSinglePermanentDelete(item, runAction, handleDeleteMany)

  return {
    pendingRestoreId,
    onRestore: handleRestore,
    onRestoreMany: handleRestoreMany,
    onPermanentDelete: handleDelete,
    onPermanentDeleteMany: handleDeleteMany
  }
}

export function useAssistantArchiveActions(refresh: () => Promise<unknown>) {
  return useDataArchiveActions('assistants', refresh)
}

export function usePaintingArchiveActions(refresh: () => Promise<unknown>) {
  return useDataArchiveActions('paintings', refresh)
}

export function useFileArchiveActions() {
  const { t } = useTranslation()
  const runAction = useArchiveActionRunner()
  const invalidate = useInvalidateCache()
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)

  // Files DataApi is read-only — restore/purge go through File IPC. Purge skips the by-id
  // paths: the entry is gone and revalidating it would cache the 404.
  const invalidateFiles = () => invalidate(['/files/entries', '/files/entries/*'])
  const invalidatePurgedFiles = () => invalidate(['/files/entries'])

  const restoreItems = async (targets: ArchiveItem[]): Promise<ArchiveBatchOutcome> => {
    const result = await requestBatchedFileMutation(
      'file.batch_restore',
      targets.map((item) => item.id)
    )
    const outcome: ArchiveBatchOutcome = { succeeded: result.succeeded, failed: result.failed }
    try {
      await invalidateFiles()
    } catch (error) {
      logger.warn('failed to refresh files after restore', error as Error)
    }
    const { activeIds: activeAfterFailure } = await inspectFailedFileIds(outcome.failed)
    if (activeAfterFailure.size === 0) return outcome
    return {
      succeeded: [...outcome.succeeded, ...activeAfterFailure],
      failed: outcome.failed.filter(({ id }) => !activeAfterFailure.has(id))
    }
  }

  const deleteItems = async (targets: ArchiveItem[]): Promise<ArchiveBatchOutcome> => {
    const result = await requestBatchedFileMutation(
      'file.batch_permanent_delete_from_trash',
      targets.map((item) => item.id)
    )
    const outcome: ArchiveBatchOutcome = { succeeded: result.succeeded, failed: result.failed }
    try {
      await invalidatePurgedFiles()
    } catch (error) {
      logger.warn('failed to refresh files after permanent delete', error as Error)
    }
    const { activeIds, missingIds } = await inspectFailedFileIds(outcome.failed)
    const staleIds = new Set([...activeIds, ...missingIds])
    if (staleIds.size === 0) return outcome
    const staleMessage = t('settings.data.trash.permanent_delete.no_longer_in_recycle_bin')
    return classifyStaleFailures(
      {
        ...outcome,
        failed: outcome.failed.map((failure) =>
          staleIds.has(failure.id) ? { ...failure, error: staleMessage } : failure
        )
      },
      staleIds
    )
  }

  const handleRestore = async (item: ArchiveItem) => {
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

  const handleDelete = (item: ArchiveItem) => runSinglePermanentDelete(item, runAction, deleteItems)

  return {
    pendingRestoreId,
    onRestore: handleRestore,
    onRestoreMany: restoreItems,
    onPermanentDelete: handleDelete,
    onPermanentDeleteMany: deleteItems
  }
}
