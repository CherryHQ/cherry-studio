import { chunk } from 'es-toolkit'
import { useCallback, useEffect, useMemo } from 'react'
import { useSWRConfig } from 'swr'
import useSWRInfinite, { unstable_serialize } from 'swr/infinite'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { OutputFor } from '@shared/ipc/types'
import type { FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

const logger = loggerService.withContext('useFileHydration')
const FILE_IPC_BATCH_SIZE = 500
type FileBatchRoute = 'file.batch_get_metadata' | 'file.batch_get_physical_paths' | 'file.batch_get_dangling_states'
type BatchKey = readonly ['files-hydration', FileBatchRoute, string, readonly FileEntryId[]]

async function fetchFileBatch([, route, , ids]: BatchKey) {
  switch (route) {
    case 'file.batch_get_metadata':
      return ipcApi.request(route, {
        items: ids.map((id) => ({ key: id, handle: { kind: 'entry' as const, entryId: id } }))
      })
    case 'file.batch_get_physical_paths':
      return ipcApi.request(route, { ids: [...ids] })
    case 'file.batch_get_dangling_states':
      return ipcApi.request(route, { ids: [...ids] })
  }
}

function useFileBatch<Route extends FileBatchRoute>(route: Route, batches: FileEntryId[][], scope: string) {
  const getKey = (index: number): BatchKey | null =>
    batches[index] ? ['files-hydration', route, scope, batches[index]] : null
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetchFileBatch, {
    revalidateFirstPage: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    keepPreviousData: true,
    // SWRInfinite writes page records before discarding an outdated aggregate.
    // Revalidate those records so a later pagination reset cannot reuse them.
    onDiscarded: () => {
      if (!isValidating) void mutate()
    }
  })

  useEffect(() => {
    if (!isValidating && size !== batches.length) void setSize(batches.length)
  }, [batches.length, isValidating, setSize, size])

  useEffect(() => {
    if (error) logger.error(`Failed to load ${route}`, error)
  }, [error, route])

  const records = useMemo(
    () => Object.assign({}, ...(batches.length > 0 ? (data ?? []) : [])) as OutputFor<Route>,
    [batches.length, data]
  )
  return { records, refresh: mutate, cacheKey: unstable_serialize(getKey) }
}

export function useFileHydration(pages: readonly { items: FileEntry[] }[], fileType?: FileType) {
  const { cache, mutate } = useSWRConfig()
  const batches = useMemo(() => {
    const rows = pages.map(({ items }) =>
      items.filter((entry) => !fileType || getFileTypeByExt(entry.ext ?? '') === fileType)
    )
    const ids = rows.flatMap((items) => chunk(items.map(({ id }) => id).sort(), FILE_IPC_BATCH_SIZE))
    const images = rows.flatMap((items) =>
      chunk(
        items
          .filter((entry) => getFileTypeByExt(entry.ext ?? '') === 'image')
          .map(({ id }) => id)
          .sort(),
        FILE_IPC_BATCH_SIZE
      )
    )
    return { ids, images }
  }, [fileType, pages])
  const scope = fileType ?? ''
  const {
    records: metadataById,
    refresh: refreshMetadata,
    cacheKey: metadataCacheKey
  } = useFileBatch('file.batch_get_metadata', batches.ids, scope)
  const {
    records: physicalPathById,
    refresh: refreshPaths,
    cacheKey: pathsCacheKey
  } = useFileBatch('file.batch_get_physical_paths', batches.images, scope)
  const {
    records: danglingStateById,
    refresh: refreshDangling,
    cacheKey: danglingCacheKey
  } = useFileBatch('file.batch_get_dangling_states', batches.ids, scope)
  const refresh = useCallback(async () => {
    const infinitePrefix = unstable_serialize(() => ['files-hydration'])
    const keys = [...cache.keys()].filter((key) => {
      if ([metadataCacheKey, pathsCacheKey, danglingCacheKey].includes(key)) return false
      return key.startsWith(infinitePrefix)
    })
    await Promise.all([
      mutate((key) => Array.isArray(key) && key[0] === 'files-hydration', undefined),
      ...keys.map((key) => mutate(key, undefined))
    ])
    await Promise.allSettled([refreshMetadata(), refreshPaths(), refreshDangling()])
  }, [cache, mutate, refreshDangling, refreshMetadata, refreshPaths, danglingCacheKey, metadataCacheKey, pathsCacheKey])

  return {
    metadataById,
    physicalPathById,
    danglingStateById,
    refresh
  }
}
