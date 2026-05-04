import type { NewPainting } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { PaintingMediaType, PaintingMode, PaintingParams } from '@shared/data/types/painting'

const logger = loggerService.withContext('PaintingMappings')

export const LEGACY_PAINTING_NAMESPACES = [
  'siliconflow_paintings',
  'dmxapi_paintings',
  'tokenflux_paintings',
  'zhipu_paintings',
  'aihubmix_image_generate',
  'aihubmix_image_remix',
  'aihubmix_image_edit',
  'aihubmix_image_upscale',
  'openai_image_generate',
  'openai_image_edit',
  'ovms_paintings',
  'ppio_draw',
  'ppio_edit'
] as const

export type LegacyPaintingNamespace = (typeof LEGACY_PAINTING_NAMESPACES)[number]

export type LegacyPaintingRecord = Record<string, unknown>

export interface LegacyPaintingsState {
  [key: string]: unknown
}

export interface PaintingFilter {
  providerId: string
  mode: PaintingMode
}

const legacyParentFieldKey = ['parent', 'Id'].join('')
const legacyParentDbKey = ['parent', '_', 'id'].join('')

export interface NormalizedPaintingRow extends Omit<NewPainting, 'orderKey'> {
  id: string
  providerId: string
  mode: PaintingMode
  mediaType: PaintingMediaType
  model: string | null
  prompt: string
  params: PaintingParams
  files: { output: string[]; input: string[] }
}

export interface PaintingTransformSuccess {
  ok: true
  value: NormalizedPaintingRow
  warnings: string[]
}

export interface PaintingTransformFailure {
  ok: false
  reason: 'missing_id' | 'empty_placeholder'
  warnings: string[]
}

export type PaintingTransformResult = PaintingTransformSuccess | PaintingTransformFailure

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getNonEmptyString(value: unknown): string | undefined {
  const stringValue = getString(value)?.trim()
  return stringValue ? stringValue : undefined
}

function getFileId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return getNonEmptyString((value as Record<string, unknown>).id)
}

function getFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    logger.warn('[getFileIds] record.files is not an array', {
      type: typeof value,
      value: String(value)?.slice(0, 200)
    })
    return []
  }

  logger.info('[getFileIds] record.files array', {
    length: value.length,
    sample: JSON.stringify(value[0])?.slice(0, 300)
  })

  return value.flatMap((item) => {
    const id = getFileId(item)
    if (!id) {
      logger.warn('[getFileIds] item has no extractable id', {
        type: typeof item,
        keys: item && typeof item === 'object' ? Object.keys(item) : 'N/A'
      })
    }
    return id ? [id] : []
  })
}

function omitUndefinedValues(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

export function getPaintingFilter(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord
): PaintingFilter | null {
  switch (namespace) {
    case 'siliconflow_paintings':
      return { providerId: 'silicon', mode: 'generate' }
    case 'tokenflux_paintings':
      return { providerId: 'tokenflux', mode: 'generate' }
    case 'zhipu_paintings':
      return { providerId: 'zhipu', mode: 'generate' }
    case 'aihubmix_image_generate':
      return { providerId: 'aihubmix', mode: 'generate' }
    case 'aihubmix_image_remix':
      return { providerId: 'aihubmix', mode: 'remix' }
    case 'aihubmix_image_edit':
      return { providerId: 'aihubmix', mode: 'edit' }
    case 'aihubmix_image_upscale':
      return { providerId: 'aihubmix', mode: 'upscale' }
    case 'openai_image_generate':
      return { providerId: getNonEmptyString(record.providerId) ?? 'new-api', mode: 'generate' }
    case 'openai_image_edit':
      return { providerId: getNonEmptyString(record.providerId) ?? 'new-api', mode: 'edit' }
    case 'ovms_paintings':
      return { providerId: 'ovms', mode: 'generate' }
    case 'ppio_draw':
      return { providerId: 'ppio', mode: 'draw' }
    case 'ppio_edit':
      return { providerId: 'ppio', mode: 'edit' }
    case 'dmxapi_paintings': {
      const generationMode = getString(record.generationMode)
      if (generationMode === 'edit') {
        return { providerId: 'dmxapi', mode: 'edit' }
      }
      if (generationMode === 'merge') {
        return { providerId: 'dmxapi', mode: 'merge' }
      }
      return { providerId: 'dmxapi', mode: 'generate' }
    }
    default:
      return null
  }
}

function buildInputFileIds(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord,
  warnings: string[]
): string[] {
  if (namespace === 'dmxapi_paintings') {
    return getFileIds(record.imageFiles)
  }

  if (Array.isArray(record.imageFiles)) {
    return getFileIds(record.imageFiles)
  }

  const imageFileId = getFileId(record.imageFile)
  if (imageFileId) {
    return [imageFileId]
  }

  if (getNonEmptyString(record.imageFile)) {
    warnings.push('Dropped legacy input image reference because only an in-memory string/object URL was available')
  }

  return []
}

function buildParams(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord,
  scope: PaintingFilter,
  warnings: string[]
): Record<string, unknown> {
  const excludedKeys = new Set([
    'id',
    'providerId',
    'mediaType',
    'media_type',
    'model',
    'prompt',
    'files',
    'urls',
    'imageFile',
    'imageFiles',
    'mask',
    'status',
    'ppioStatus',
    'taskId',
    'generationId',
    legacyParentFieldKey,
    legacyParentDbKey
  ])

  const copiedEntries = Object.entries(record).filter(([key]) => !excludedKeys.has(key))
  const params = Object.fromEntries(copiedEntries)

  const maskFileId = getFileId(record.mask)
  if (maskFileId) {
    params.maskFileId = maskFileId
  } else if (getNonEmptyString(record.ppioMask)) {
    warnings.push('Dropped legacy PPIO mask because it only existed as inline base64 data')
  }

  const taskId = getNonEmptyString(record.taskId) ?? getNonEmptyString(record.generationId)
  if (taskId) {
    params.taskId = taskId
  }

  if (scope.mode === 'edit' && namespace !== 'dmxapi_paintings') {
    params.editVariant = 'img2img'
  }

  if (namespace === 'dmxapi_paintings') {
    const generationMode = getString(record.generationMode)
    if (generationMode === 'edit') {
      params.editVariant = 'img2img'
    }
  }

  return omitUndefinedValues(params)
}

export function transformLegacyPaintingRecord(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord
): PaintingTransformResult {
  const warnings: string[] = []
  const scope = getPaintingFilter(namespace, record)

  if (!scope) {
    return {
      ok: false,
      reason: 'empty_placeholder',
      warnings
    }
  }

  const id = getNonEmptyString(record.id)
  if (!id) {
    return {
      ok: false,
      reason: 'missing_id',
      warnings
    }
  }

  // --- DEBUG: log raw record shape ---
  const recordKeys = Object.keys(record)
  logger.info(`[transform] ${namespace} id=${id}`, {
    keys: recordKeys.join(','),
    hasFiles: 'files' in record,
    filesType: typeof record.files,
    filesIsArray: Array.isArray(record.files),
    filesLength: Array.isArray(record.files) ? (record.files as unknown[]).length : 'N/A',
    filesRaw: JSON.stringify(record.files)?.slice(0, 500)
  })

  const outputFileIds = getFileIds(record.files)
  const inputFileIds = buildInputFileIds(namespace, record, warnings)
  const params = buildParams(namespace, record, scope, warnings)
  const prompt = getString(record.prompt) ?? ''
  const hasTaskId = typeof params.taskId === 'string' && params.taskId.trim().length > 0

  logger.info(`[transform] ${namespace} id=${id} result`, {
    outputFileIdsCount: outputFileIds.length,
    outputFileIds: outputFileIds.slice(0, 5),
    inputFileIdsCount: inputFileIds.length,
    promptLength: prompt.length,
    hasTaskId
  })

  if (!prompt.trim() && outputFileIds.length === 0 && inputFileIds.length === 0 && !hasTaskId) {
    return {
      ok: false,
      reason: 'empty_placeholder',
      warnings
    }
  }

  return {
    ok: true,
    value: {
      id,
      providerId: scope.providerId,
      mode: scope.mode,
      mediaType: 'image',
      model: getNonEmptyString(record.model) ?? null,
      prompt,
      params,
      files: { output: outputFileIds, input: inputFileIds }
    },
    warnings
  }
}
