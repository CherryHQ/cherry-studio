import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, PaintingAction } from '@renderer/types'
import type { CreatePaintingDto, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import { PAINTINGS_MAX_LIMIT } from '@shared/data/api/schemas/paintings'
import type { Painting as PaintingRecord, PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('data/hooks/usePaintings')

const PAINTINGS_QUERY_LIMIT = PAINTINGS_MAX_LIMIT
const PATCH_DEBOUNCE_MS = 300

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []
  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }
    return []
  })
}

async function hydratePaintingRecord(record: PaintingRecord): Promise<PaintingAction> {
  const files = (
    await Promise.all((record.fileIds ?? []).map(async (id) => (await FileManager.getFile(id)) ?? null))
  ).filter((file): file is FileMetadata => Boolean(file))

  return {
    id: record.id,
    providerId: record.providerId,
    model: record.model ?? undefined,
    prompt: record.prompt,
    urls: [],
    files,
    ...record.params
  } as PaintingAction
}

// ---------------------------------------------------------------------------
// Scoped hook — queries by { providerId, mode } instead of full-table pull
// ---------------------------------------------------------------------------

export interface PaintingScope {
  providerId: string
  mode?: PaintingMode
}

function toPaintingDtoScoped(scope: PaintingScope, painting: PaintingAction): CreatePaintingDto {
  const reservedKeys = new Set(['id', 'providerId', 'urls', 'files', 'model', 'prompt'])
  return {
    id: painting.id,
    providerId: scope.providerId,
    mode: scope.mode ?? 'generate',
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: Object.fromEntries(Object.entries(painting).filter(([key]) => !reservedKeys.has(key))),
    fileIds: getTopLevelFileIds(painting.files),
    inputFileIds: []
  }
}

function toPaintingPatchScoped(painting: PaintingAction): UpdatePaintingDto {
  const reservedKeys = new Set(['id', 'providerId', 'urls', 'files', 'model', 'prompt'])
  return {
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: Object.fromEntries(Object.entries(painting).filter(([key]) => !reservedKeys.has(key))),
    fileIds: getTopLevelFileIds(painting.files),
    inputFileIds: []
  }
}

export function usePaintingList(scope: PaintingScope) {
  const { data, isLoading: isQueryLoading } = useQuery('/paintings', {
    query: {
      providerId: scope.providerId,
      mode: scope.mode,
      limit: PAINTINGS_QUERY_LIMIT,
      offset: 0
    }
  })

  const [items, setItems] = useState<PaintingAction[]>([])
  const [hasHydrated, setHasHydrated] = useState(false)
  const patchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingCreatesRef = useRef<Map<string, { painting: PaintingAction; deleted?: boolean }>>(new Map())

  useEffect(() => {
    let cancelled = false

    setHasHydrated(false)

    const syncFromRemote = async () => {
      const remoteItems = data?.items ?? []
      const hydrated = await Promise.all(remoteItems.map(async (record) => hydratePaintingRecord(record)))
      if (!cancelled) {
        setItems((current) => {
          const transientUrls = new Map(current.map((p) => [p.id, p.urls ?? []]))
          return hydrated.map(
            (p) =>
              ({
                ...p,
                urls: transientUrls.get(p.id) ?? p.urls
              }) as PaintingAction
          )
        })
        setHasHydrated(true)
      }
    }

    void syncFromRemote()
    return () => {
      cancelled = true
    }
  }, [data])

  useEffect(() => {
    const timersRef = patchTimersRef.current
    return () => {
      for (const timer of timersRef.values()) {
        clearTimeout(timer)
      }
    }
  }, [])

  const queuePatch = useCallback((painting: PaintingAction) => {
    const existingTimer = patchTimersRef.current.get(painting.id)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      patchTimersRef.current.delete(painting.id)
      void dataApiService
        .patch(`/paintings/${painting.id}` as '/paintings/:id', { body: toPaintingPatchScoped(painting) })
        .catch((error) => logger.error('Failed to persist painting update', error as Error))
    }, PATCH_DEBOUNCE_MS)

    patchTimersRef.current.set(painting.id, timer)
  }, [])

  const add = useCallback(
    (painting: PaintingAction, createMode?: PaintingMode) => {
      setItems((current) => [painting, ...current.filter((item) => item.id !== painting.id)])
      pendingCreatesRef.current.set(painting.id, { painting })

      const effectiveScope: PaintingScope = { providerId: scope.providerId, mode: createMode ?? scope.mode }

      void dataApiService
        .post('/paintings', { body: toPaintingDtoScoped(effectiveScope, painting) })
        .then(() => {
          const latest = pendingCreatesRef.current.get(painting.id)
          pendingCreatesRef.current.delete(painting.id)

          if (!latest) return

          if (latest.deleted) {
            void dataApiService.delete(`/paintings/${painting.id}` as '/paintings/:id').catch((error) => {
              logger.error('Failed to delete pending painting after create', error as Error)
            })
            return
          }

          queuePatch(latest.painting)
        })
        .catch((error) => {
          pendingCreatesRef.current.delete(painting.id)
          logger.error('Failed to create painting', error as Error)
        })

      return painting
    },
    [scope, queuePatch]
  )

  const remove = useCallback(async (painting: PaintingAction) => {
    void FileManager.deleteFiles(painting.files)
    setItems((current) => current.filter((item) => item.id !== painting.id))

    const pendingCreate = pendingCreatesRef.current.get(painting.id)
    if (pendingCreate) {
      pendingCreatesRef.current.set(painting.id, { ...pendingCreate, deleted: true })
      return
    }

    const timer = patchTimersRef.current.get(painting.id)
    if (timer) {
      clearTimeout(timer)
      patchTimersRef.current.delete(painting.id)
    }

    try {
      await dataApiService.delete(`/paintings/${painting.id}` as '/paintings/:id')
    } catch (error) {
      logger.error('Failed to delete painting', error as Error)
    }
  }, [])

  const update = useCallback(
    (painting: PaintingAction) => {
      setItems((current) => current.map((item) => (item.id === painting.id ? painting : item)))

      const pendingCreate = pendingCreatesRef.current.get(painting.id)
      if (pendingCreate) {
        pendingCreatesRef.current.set(painting.id, { ...pendingCreate, painting })
        return
      }

      queuePatch(painting)
    },
    [queuePatch]
  )

  const reorder = useCallback((paintings: PaintingAction[]) => {
    setItems(paintings)

    const hasPendingCreate = paintings.some((p) => pendingCreatesRef.current.has(p.id))
    if (hasPendingCreate) return

    void dataApiService
      .post('/paintings/reorder', { body: { orderedIds: paintings.map((p) => p.id) } })
      .catch((error) => logger.error('Failed to reorder paintings', error as Error))
  }, [])

  return useMemo(
    () => ({ items, isLoading: isQueryLoading, hasHydrated, add, remove, update, reorder }),
    [items, isQueryLoading, hasHydrated, add, remove, update, reorder]
  )
}
