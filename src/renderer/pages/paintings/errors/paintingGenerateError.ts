import i18n from '@renderer/i18n/resolver'
import { contextFromUnknown, diagnosticErrorFromUnknown } from '@renderer/services/AppErrorContextService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import {
  normalizePaintingGenerateError,
  PaintingGenerateError,
  type PaintingGenerateErrorCode
} from '@shared/ai/paintingGenerateError'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { PAINTING_ERROR_PARAM_KEYS } from '@shared/types/appError'
import { summarizeErrorParams } from '@shared/utils/appError'
import { isNonChatModel } from '@shared/utils/model'

// Re-export the presentation-free core (codes, class, create/normalize) so
// paintings renderer code has a single import for painting errors. The
// renderer layer adds the i18n translation + toast/modal presentation.
export {
  createPaintingGenerateError,
  normalizePaintingGenerateError,
  PaintingGenerateError,
  type PaintingGenerateErrorCode,
  type PaintingGenerateErrorOptions
} from '@shared/ai/paintingGenerateError'

export function translatePaintingGenerateError(error: Error): string {
  if (!(error instanceof PaintingGenerateError) || error.code === 'REMOTE_ERROR') {
    return i18n.t('paintings.generate_failed')
  }

  const keyMap: Record<Exclude<PaintingGenerateErrorCode, 'REMOTE_ERROR'>, string> = {
    PROVIDER_DISABLED: 'error.provider_disabled',
    PROMPT_REQUIRED: 'paintings.prompt_required',
    TEXT_DESC_REQUIRED: 'paintings.text_desc_required',
    IMAGE_REQUIRED: 'paintings.image_file_required',
    IMAGE_RETRY_REQUIRED: 'paintings.image_file_retry',
    EDIT_IMAGE_REQUIRED: 'paintings.edit.image_required',
    INPUT_IMAGE_LIMIT_EXCEEDED: 'paintings.input_image_limit_exceeded',
    MISSING_REQUIRED_FIELDS: 'error.missing_required_fields',
    IMAGE_HANDLE_REQUIRED: 'paintings.image_handle_required',
    REQ_ERROR_TOKEN: 'paintings.req_error_token',
    REQ_ERROR_NO_BALANCE: 'paintings.req_error_no_balance',
    OPERATION_FAILED: 'paintings.operation_failed',
    GENERATE_FAILED: 'paintings.generate_failed',
    IMAGE_MIX_FAILED: 'paintings.image_mix_failed',
    CUSTOM_SIZE_REQUIRED: 'paintings.zhipu.custom_size_required',
    CUSTOM_SIZE_RANGE: 'paintings.zhipu.custom_size_range',
    CUSTOM_SIZE_DIVISIBLE: 'paintings.zhipu.custom_size_divisible',
    CUSTOM_SIZE_PIXELS: 'paintings.zhipu.custom_size_pixels'
  }

  return i18n.t(keyMap[error.code])
}

interface PaintingErrorPresentation {
  readonly operation?: string
  readonly providerId?: string
  readonly modelId?: string
  readonly recordId?: string
  readonly params?: Readonly<Record<string, unknown>>
  readonly imageOnly?: boolean
}

/** True only for a model the doctor already treats as non-chat. Unknown models stay unset. */
function paintingImageOnly(model: Model | undefined): boolean | undefined {
  if (!model) return undefined
  return isNonChatModel(model) ? true : undefined
}

function localModelId(model: Model): string | undefined {
  try {
    return parseUniqueModelId(model.id).modelId
  } catch {
    return undefined
  }
}

/**
 * Doctor looks up `providerId + modelId` in the user's model table.
 * A painting may store the API id, which is a different string when the provider overrides it.
 */
export function paintingDoctorModel(
  models: readonly Model[],
  stored: string | undefined
): { readonly modelId?: string; readonly imageOnly?: true } {
  if (!stored) return {}
  const byLocal = models.find((item) => item.id === stored || localModelId(item) === stored)
  const resolved = byLocal ?? models.find((item) => item.apiModelId === stored)
  const modelId = resolved ? localModelId(resolved) : undefined
  if (!modelId) return {}
  return paintingImageOnly(resolved) ? { modelId, imageOnly: true } : { modelId }
}

export function presentPaintingGenerateError(error: unknown, meta: PaintingErrorPresentation = {}) {
  const normalized = normalizePaintingGenerateError(error)
  const message = translatePaintingGenerateError(normalized)
  const original =
    normalized instanceof PaintingGenerateError && normalized.cause !== undefined ? normalized.cause : error
  const params = summarizeErrorParams(meta.params, PAINTING_ERROR_PARAM_KEYS)
  const context = contextFromUnknown(original, {
    source: 'painting',
    operation: meta.operation ?? 'painting.generate',
    message,
    ...(meta.providerId ? { providerId: meta.providerId } : {}),
    ...(meta.modelId ? { modelId: meta.modelId } : {}),
    ...(meta.recordId ? { recordId: meta.recordId } : {}),
    ...(params ? { params } : {}),
    ...(meta.imageOnly ? { imageOnly: true } : {})
  })
  const serializedError = diagnosticErrorFromUnknown(original)
  const data = {
    errorContext: context,
    localizedErrorMessage: message,
    ...(serializedError ? { serializedError } : {})
  }

  if (normalized instanceof PaintingGenerateError && normalized.presentation === 'toast') {
    const payload = { title: message, cause: original, data, key: context.id }
    if (normalized.severity === 'warning') toast.warning(payload)
    else toast.error(payload)
    return
  }

  void popup.error({
    content: message,
    centered: true,
    cause: original,
    data
  })
}
