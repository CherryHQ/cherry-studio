import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addPainting, removePainting, updatePainting, updatePaintings } from '@renderer/store/paintings'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import type { Painting, PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useProviders } from './useProviders'

const logger = loggerService.withContext('usePaintings')

const PAINTINGS_QUERY = { page: 1, limit: 5000 } as const

type PaintingNamespace = keyof PaintingsState

interface PendingPaintingPersistence {
  namespace: PaintingNamespace
  painting: PaintingAction
  needsCreate: boolean
  needsUpdate: boolean
}

interface PaintingPersistenceQueueState {
  running: boolean
  created: boolean
  pending?: PendingPaintingPersistence
}

interface NamespaceConfig {
  provider: string
  mode: PaintingMode
}

const NAMESPACE_CONFIGS = {
  siliconflow_paintings: { provider: 'silicon', mode: 'generate' },
  dmxapi_paintings: { provider: 'dmxapi', mode: 'generate' },
  tokenflux_paintings: { provider: 'tokenflux', mode: 'generate' },
  zhipu_paintings: { provider: 'zhipu', mode: 'generate' },
  aihubmix_image_generate: { provider: 'aihubmix', mode: 'generate' },
  aihubmix_image_remix: { provider: 'aihubmix', mode: 'remix' },
  aihubmix_image_edit: { provider: 'aihubmix', mode: 'edit' },
  aihubmix_image_upscale: { provider: 'aihubmix', mode: 'upscale' },
  openai_image_generate: { provider: 'new-api', mode: 'generate' },
  openai_image_edit: { provider: 'new-api', mode: 'edit' },
  ovms_paintings: { provider: 'ovms', mode: 'generate' },
  ppio_draw: { provider: 'ppio', mode: 'draw' },
  ppio_edit: { provider: 'ppio', mode: 'edit' }
} as const satisfies Record<PaintingNamespace, NamespaceConfig>

const FIXED_PROVIDER_IDS = new Set(
  Object.entries(NAMESPACE_CONFIGS)
    .filter(([namespace]) => !namespace.startsWith('openai_image_'))
    .map(([, config]) => config.provider)
) as ReadonlySet<string>

const PUBLIC_KEYS = new Set([
  'id',
  'urls',
  'files',
  'providerId',
  'model',
  'prompt',
  'negativePrompt',
  'status',
  'ppioStatus'
])

function emptyPaintingsState(): PaintingsState {
  return {
    siliconflow_paintings: [],
    dmxapi_paintings: [],
    tokenflux_paintings: [],
    zhipu_paintings: [],
    aihubmix_image_generate: [],
    aihubmix_image_remix: [],
    aihubmix_image_edit: [],
    aihubmix_image_upscale: [],
    openai_image_generate: [],
    openai_image_edit: [],
    ovms_paintings: [],
    ppio_draw: [],
    ppio_edit: []
  }
}

function getNamespace(namespace: PaintingNamespace, painting?: PaintingAction): NamespaceConfig {
  const base = NAMESPACE_CONFIGS[namespace]
  if (namespace === 'openai_image_generate' || namespace === 'openai_image_edit') {
    return { ...base, provider: painting?.providerId || base.provider }
  }
  return base
}

function toDataApiBody(namespace: PaintingNamespace, painting: PaintingAction, options: { includeId: boolean }) {
  const config = getNamespace(namespace, painting)
  const params: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(painting)) {
    if (!PUBLIC_KEYS.has(key) && value !== undefined) {
      params[key] = value
    }
  }

  const body = {
    provider: config.provider,
    mode: config.mode,
    model: typeof painting.model === 'string' && painting.model.length > 0 ? painting.model : undefined,
    prompt: typeof painting.prompt === 'string' ? painting.prompt : undefined,
    negativePrompt: typeof painting.negativePrompt === 'string' ? painting.negativePrompt : undefined,
    status: typeof painting.status === 'string' ? painting.status : firstString(painting.ppioStatus),
    urls: Array.isArray(painting.urls) ? painting.urls : [],
    fileEntryIds: Array.isArray(painting.files) ? painting.files.map((file) => file.id) : [],
    params
  }

  return options.includeId ? { id: painting.id, ...body } : body
}

function toLegacyPainting(row: Painting, namespace: PaintingNamespace): PaintingAction {
  const painting: PaintingAction = {
    ...row.params,
    id: row.id,
    urls: row.urls,
    files: row.files,
    model: row.model,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt
  }

  if (row.status) {
    painting.status = row.status as PaintingAction['status']
  }

  if (namespace === 'openai_image_generate' || namespace === 'openai_image_edit') {
    painting.providerId = row.provider
  }

  if (namespace === 'ppio_draw' || namespace === 'ppio_edit') {
    painting.ppioStatus = row.status as PaintingAction['ppioStatus']
  }

  return painting
}

function namespaceForRow(row: Painting, newApiProviderIds: Set<string>): PaintingNamespace | undefined {
  for (const [namespace, config] of Object.entries(NAMESPACE_CONFIGS) as Array<[PaintingNamespace, NamespaceConfig]>) {
    if (namespace.startsWith('openai_image_')) continue
    if (row.provider === config.provider && row.mode === config.mode) {
      return namespace
    }
  }

  if (row.mode === 'generate' && isNewApiPaintingProvider(row.provider, newApiProviderIds)) {
    return 'openai_image_generate'
  }

  if (row.mode === 'edit' && isNewApiPaintingProvider(row.provider, newApiProviderIds)) {
    return 'openai_image_edit'
  }

  return undefined
}

function groupRows(rows: Painting[], newApiProviderIds: Set<string>): PaintingsState {
  const grouped = emptyPaintingsState()

  for (const row of rows) {
    const namespace = namespaceForRow(row, newApiProviderIds)
    if (!namespace) {
      logger.warn('Skipped painting with unknown provider/mode', { id: row.id, provider: row.provider, mode: row.mode })
      continue
    }
    pushPainting(grouped, namespace, toLegacyPainting(row, namespace))
  }

  const orderKeys = new Map(rows.map((row) => [row.id, row.orderKey]))
  for (const [namespace, paintings] of Object.entries(grouped) as Array<[PaintingNamespace, PaintingAction[]]>) {
    paintings.sort((left, right) => {
      return (orderKeys.get(left.id) || '').localeCompare(orderKeys.get(right.id) || '')
    })
    grouped[namespace] = paintings
  }

  return grouped
}

function pushPainting(grouped: PaintingsState, namespace: PaintingNamespace, painting: PaintingAction) {
  ;(grouped[namespace] as PaintingAction[]).push(painting)
}

function isNewApiPaintingProvider(providerId: string, newApiProviderIds: Set<string>): boolean {
  return newApiProviderIds.has(providerId) || (!FIXED_PROVIDER_IDS.has(providerId) && providerId.length > 0)
}

function isNewApiRuntimeProvider(provider: { id: string; presetProviderId?: string }): boolean {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id) || provider.presetProviderId === 'new-api'
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

function logDataApiError(action: string, error: unknown) {
  logger.error(`Failed to ${action} painting`, error instanceof Error ? error : new Error(String(error)))
}

export function usePaintings() {
  const siliconflow_paintings = useAppSelector((state) => state.paintings.siliconflow_paintings)
  const dmxapi_paintings = useAppSelector((state) => state.paintings.dmxapi_paintings)
  const tokenflux_paintings = useAppSelector((state) => state.paintings.tokenflux_paintings)
  const zhipu_paintings = useAppSelector((state) => state.paintings.zhipu_paintings)
  const aihubmix_image_generate = useAppSelector((state) => state.paintings.aihubmix_image_generate)
  const aihubmix_image_remix = useAppSelector((state) => state.paintings.aihubmix_image_remix)
  const aihubmix_image_edit = useAppSelector((state) => state.paintings.aihubmix_image_edit)
  const aihubmix_image_upscale = useAppSelector((state) => state.paintings.aihubmix_image_upscale)
  const openai_image_generate = useAppSelector((state) => state.paintings.openai_image_generate)
  const openai_image_edit = useAppSelector((state) => state.paintings.openai_image_edit)
  const ovms_paintings = useAppSelector((state) => state.paintings.ovms_paintings)
  const ppio_draw = useAppSelector((state) => state.paintings.ppio_draw)
  const ppio_edit = useAppSelector((state) => state.paintings.ppio_edit)
  const dispatch = useAppDispatch()
  const { providers } = useProviders()
  const knownPaintingIdsRef = useRef(new Set<string>())
  const persistenceQueuesRef = useRef(new Map<string, PaintingPersistenceQueueState>())

  const newApiProviderIds = useMemo(
    () =>
      new Set([
        'new-api',
        'cherryin',
        'aionly',
        ...providers.filter(isNewApiRuntimeProvider).map((provider) => provider.id)
      ]),
    [providers]
  )

  const { data, refetch } = useQuery('/paintings', { query: PAINTINGS_QUERY })

  useEffect(() => {
    if (!data) return

    knownPaintingIdsRef.current = new Set(data.items.map((item) => item.id))

    const grouped = groupRows(data.items, newApiProviderIds)
    for (const [namespace, paintings] of Object.entries(grouped) as Array<[PaintingNamespace, PaintingAction[]]>) {
      dispatch(updatePaintings({ namespace, paintings }))
    }
  }, [data, dispatch, newApiProviderIds])

  const flushPaintingPersistence = useCallback(
    async function flushPaintingPersistence(paintingId: string) {
      const state = persistenceQueuesRef.current.get(paintingId)
      if (!state || state.running) return

      state.running = true
      let lastAttemptSucceeded = false

      try {
        while (state.pending) {
          const next = state.pending
          state.pending = undefined

          const shouldCreate = next.needsCreate && !state.created

          if (shouldCreate) {
            try {
              await dataApiService.post('/paintings', {
                body: toDataApiBody(next.namespace, next.painting, { includeId: true })
              })
              state.created = true
              knownPaintingIdsRef.current.add(paintingId)
              lastAttemptSucceeded = true
            } catch (error) {
              lastAttemptSucceeded = false
              logDataApiError('create', error)
              continue
            }
          }

          if (next.needsUpdate && !shouldCreate) {
            try {
              await dataApiService.patch(`/paintings/${paintingId}`, {
                body: toDataApiBody(next.namespace, next.painting, { includeId: false })
              })
              lastAttemptSucceeded = true
            } catch (error) {
              lastAttemptSucceeded = false
              logDataApiError('update', error)
            }
          }
        }
      } finally {
        state.running = false
        if (state.pending) {
          void flushPaintingPersistence(paintingId)
        } else if (state.created) {
          persistenceQueuesRef.current.delete(paintingId)
          if (lastAttemptSucceeded) {
            void refetch()
          }
        } else {
          persistenceQueuesRef.current.set(paintingId, state)
        }
      }
    },
    [refetch]
  )

  const enqueuePaintingPersistence = useCallback(
    (
      namespace: PaintingNamespace,
      painting: PaintingAction,
      change: Pick<PendingPaintingPersistence, 'needsCreate' | 'needsUpdate'>
    ) => {
      const existingState = persistenceQueuesRef.current.get(painting.id)
      const state = existingState ?? {
        running: false,
        created: knownPaintingIdsRef.current.has(painting.id)
      }
      const pending = state.pending

      state.pending = {
        namespace,
        painting,
        needsCreate: Boolean(
          pending?.needsCreate || change.needsCreate || (change.needsUpdate && existingState && !state.created)
        ),
        needsUpdate: Boolean(pending?.needsUpdate || change.needsUpdate)
      }
      persistenceQueuesRef.current.set(painting.id, state)
      void flushPaintingPersistence(painting.id)
    },
    [flushPaintingPersistence]
  )

  const persistCreate = useCallback(
    (namespace: PaintingNamespace, painting: PaintingAction) => {
      enqueuePaintingPersistence(namespace, painting, { needsCreate: true, needsUpdate: false })
    },
    [enqueuePaintingPersistence]
  )

  const persistUpdate = useCallback(
    (namespace: PaintingNamespace, painting: PaintingAction) => {
      enqueuePaintingPersistence(namespace, painting, { needsCreate: false, needsUpdate: true })
    },
    [enqueuePaintingPersistence]
  )

  const persistDelete = useCallback(
    (painting: PaintingAction) => {
      void dataApiService
        .delete(`/paintings/${painting.id}`)
        .then(() => refetch())
        .catch((error) => logDataApiError('delete', error))
    },
    [refetch]
  )

  const persistOrder = useCallback(
    (namespace: PaintingNamespace, paintings: PaintingAction[]) => {
      const config = getNamespace(namespace, paintings[0])
      void dataApiService
        .patch('/paintings/order', {
          body: {
            provider: config.provider,
            mode: config.mode,
            ids: paintings.map((painting) => painting.id)
          }
        })
        .then(() => refetch())
        .catch((error) => logDataApiError('reorder', error))
    },
    [refetch]
  )

  return {
    siliconflow_paintings,
    dmxapi_paintings,
    tokenflux_paintings,
    zhipu_paintings,
    aihubmix_image_generate,
    aihubmix_image_remix,
    aihubmix_image_edit,
    aihubmix_image_upscale,
    openai_image_generate,
    openai_image_edit,
    ovms_paintings,
    ppio_draw,
    ppio_edit,
    addPainting: (namespace: PaintingNamespace, painting: PaintingAction) => {
      dispatch(addPainting({ namespace, painting }))
      persistCreate(namespace, painting)
      return painting
    },
    removePainting: async (namespace: PaintingNamespace, painting: PaintingAction) => {
      dispatch(removePainting({ namespace, painting }))
      persistDelete(painting)
    },
    updatePainting: (namespace: PaintingNamespace, painting: PaintingAction) => {
      dispatch(updatePainting({ namespace, painting }))
      persistUpdate(namespace, painting)
    },
    updatePaintings: (namespace: PaintingNamespace, paintings: PaintingAction[]) => {
      dispatch(updatePaintings({ namespace, paintings }))
      persistOrder(namespace, paintings)
    }
  }
}
