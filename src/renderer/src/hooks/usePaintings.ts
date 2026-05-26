import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addPainting, removePainting, updatePainting, updatePaintings } from '@renderer/store/paintings'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import type { Painting, PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo } from 'react'

import { useAllProviders } from './useProvider'

const logger = loggerService.withContext('usePaintings')

const PAINTINGS_QUERY = { page: 1, limit: 5000 } as const

type PaintingNamespace = keyof PaintingsState

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
    files: Array.isArray(painting.files) ? painting.files : [],
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

  return grouped
}

function pushPainting(grouped: PaintingsState, namespace: PaintingNamespace, painting: PaintingAction) {
  ;(grouped[namespace] as PaintingAction[]).push(painting)
}

function isNewApiPaintingProvider(providerId: string, newApiProviderIds: Set<string>): boolean {
  return newApiProviderIds.has(providerId) || (!FIXED_PROVIDER_IDS.has(providerId) && providerId.length > 0)
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
  const providers = useAllProviders()

  const newApiProviderIds = useMemo(
    () =>
      new Set(['new-api', 'cherryin', 'aionly', ...providers.filter(isNewApiProvider).map((provider) => provider.id)]),
    [providers]
  )

  const { data, refetch } = useQuery('/paintings', { query: PAINTINGS_QUERY })

  useEffect(() => {
    if (!data) return

    const grouped = groupRows(data.items, newApiProviderIds)
    for (const [namespace, paintings] of Object.entries(grouped) as Array<[PaintingNamespace, PaintingAction[]]>) {
      dispatch(updatePaintings({ namespace, paintings }))
    }
  }, [data, dispatch, newApiProviderIds])

  const persistCreate = useCallback(
    (namespace: PaintingNamespace, painting: PaintingAction) => {
      void dataApiService
        .post('/paintings', { body: toDataApiBody(namespace, painting, { includeId: true }) })
        .then(() => refetch())
        .catch((error) => logDataApiError('create', error))
    },
    [refetch]
  )

  const persistUpdate = useCallback(
    (namespace: PaintingNamespace, painting: PaintingAction) => {
      void dataApiService
        .patch(`/paintings/${painting.id}`, { body: toDataApiBody(namespace, painting, { includeId: false }) })
        .then(() => refetch())
        .catch((error) => logDataApiError('update', error))
    },
    [refetch]
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
      void FileManager.deleteFiles(painting.files)
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
