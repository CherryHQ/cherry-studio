import type { NewPaintingRow } from '@data/db/schemas/painting'
import type { PaintingMode, PaintingParams } from '@shared/data/types/painting'

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

export interface PaintingScope {
  providerId: string
  mode: PaintingMode
}

export interface NormalizedPaintingRow extends Omit<NewPaintingRow, 'sortOrder'> {
  id: string
  providerId: string
  mode: PaintingMode
  model: string | null
  prompt: string
  params: PaintingParams
  fileIds: string[]
  inputFileIds: string[]
  parentId: string | null
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
    return []
  }

  return value.flatMap((item) => {
    const id = getFileId(item)
    return id ? [id] : []
  })
}

function omitUndefinedValues(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

export function getPaintingScope(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord
): PaintingScope | null {
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
      return { providerId: 'aihubmix', mode: 'edit' }
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
      return { providerId: 'ppio', mode: 'generate' }
    case 'ppio_edit':
      return { providerId: 'ppio', mode: 'edit' }
    case 'dmxapi_paintings': {
      const generationMode = getString(record.generationMode)
      if (generationMode === 'edit' || generationMode === 'merge') {
        return { providerId: 'dmxapi', mode: 'edit' }
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
  scope: PaintingScope,
  warnings: string[]
): Record<string, unknown> {
  const excludedKeys = new Set([
    'id',
    'providerId',
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
    'generationId'
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

  if (namespace === 'aihubmix_image_remix') {
    params.editVariant = 'remix'
  } else if (scope.mode === 'edit' && namespace !== 'dmxapi_paintings') {
    params.editVariant = 'img2img'
  }

  if (namespace === 'dmxapi_paintings') {
    const generationMode = getString(record.generationMode)
    if (generationMode === 'edit') {
      params.editVariant = 'img2img'
    } else if (generationMode === 'merge') {
      params.legacyGenerationMode = 'merge'
    }
  }

  return omitUndefinedValues(params)
}

export function transformLegacyPaintingRecord(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord
): PaintingTransformResult {
  const warnings: string[] = []
  const scope = getPaintingScope(namespace, record)

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

  const fileIds = getFileIds(record.files)
  const inputFileIds = buildInputFileIds(namespace, record, warnings)
  const params = buildParams(namespace, record, scope, warnings)
  const prompt = getString(record.prompt) ?? ''
  const hasTaskId = typeof params.taskId === 'string' && params.taskId.trim().length > 0

  if (!prompt.trim() && fileIds.length === 0 && inputFileIds.length === 0 && !hasTaskId) {
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
      model: getNonEmptyString(record.model) ?? null,
      prompt,
      params,
      fileIds,
      inputFileIds,
      parentId: null
    },
    warnings
  }
}
