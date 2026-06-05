import type { InsertPaintingRow } from '@data/db/schemas/painting'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'

import { type LegacyModelRef, legacyModelToUniqueId } from '../transformers/ModelTransformers'

export const LEGACY_PAINTING_NAMESPACES = [
  'siliconflow_paintings',
  'dmxapi_paintings',
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

/**
 * Painting row prepared for insert into the v2 `painting` table.
 *
 * The `files` field is **not persisted on the row** — the v2 schema removed
 * the JSON files column. Output / input file ids travel separately via
 * `LegacyPaintingFileRefs` so the migrator can emit `file_ref` rows once the
 * painting and its referenced `file_entry` rows are both in place.
 */
export interface NormalizedPaintingRow extends Omit<InsertPaintingRow, 'orderKey'> {
  id: string
  providerId: string
  modelId: string | null
  prompt: string
}

/**
 * Source `file_entry.id`s extracted from a legacy painting record. Translated
 * 1:1 into `file_ref` rows with `sourceType='painting'`,
 * `sourceId=painting.id`, `role='output'|'input'`.
 */
export interface LegacyPaintingFileRefs {
  output: string[]
  input: string[]
}

export interface PaintingTransformSuccess {
  ok: true
  value: NormalizedPaintingRow
  files: LegacyPaintingFileRefs
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
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const id = getFileId(item)
    return id ? [id] : []
  })
}

function isLegacyModelRef(value: unknown): value is LegacyModelRef {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function createScopedModelId(providerId: string, rawModelId: string, warnings: string[]): string | null {
  try {
    return createUniqueModelId(providerId, rawModelId)
  } catch (error) {
    warnings.push(`Dropped invalid legacy model id '${rawModelId}': ${error instanceof Error ? error.message : error}`)
    return null
  }
}

function normalizeLegacyModelId(value: unknown, providerId: string, warnings: string[]): string | null {
  if (isLegacyModelRef(value)) {
    const normalized = legacyModelToUniqueId(value)
    if (normalized) {
      return normalized
    }

    const rawModelId = getNonEmptyString(value.id)
    if (!rawModelId) {
      return null
    }

    if (isUniqueModelId(rawModelId)) {
      return rawModelId
    }

    return createScopedModelId(providerId, rawModelId, warnings)
  }

  const rawModelId = getNonEmptyString(value)
  if (!rawModelId) {
    return null
  }

  if (isUniqueModelId(rawModelId)) {
    return rawModelId
  }

  return createScopedModelId(providerId, rawModelId, warnings)
}

function resolveLegacyPaintingModelId(
  record: LegacyPaintingRecord,
  scope: PaintingFilter,
  warnings: string[]
): string | null {
  return (
    normalizeLegacyModelId(record.modelId, scope.providerId, warnings) ??
    normalizeLegacyModelId(record.model, scope.providerId, warnings) ??
    null
  )
}

function isOpenAiCompatibleNamespace(namespace: LegacyPaintingNamespace): boolean {
  return namespace === 'openai_image_generate' || namespace === 'openai_image_edit'
}

export function getPaintingFilter(
  namespace: LegacyPaintingNamespace,
  record: LegacyPaintingRecord
): PaintingFilter | null {
  switch (namespace) {
    case 'siliconflow_paintings':
      return { providerId: 'silicon', mode: 'generate' }
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

  const outputFileIds = getFileIds(record.files)
  const inputFileIds = buildInputFileIds(namespace, record, warnings)
  const prompt = getString(record.prompt) ?? ''

  if (isOpenAiCompatibleNamespace(namespace) && !getNonEmptyString(record.providerId)) {
    warnings.push('Defaulted missing OpenAI-compatible providerId to new-api')
  }

  // v2 painting row is a frozen receipt: prompt + output files are the only
  // user-visible artefacts. Pending v1 tasks without a prompt or any file
  // (taskId-only placeholders) carried no recoverable state once params/mode
  // were dropped, so they are filtered out here. Edit-only records with input
  // files but no output still pass — the input file is preserved as a ref.
  if (!prompt.trim() && outputFileIds.length === 0 && inputFileIds.length === 0) {
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
      modelId: resolveLegacyPaintingModelId(record, scope, warnings),
      prompt
    },
    files: { output: outputFileIds, input: inputFileIds },
    warnings
  }
}
