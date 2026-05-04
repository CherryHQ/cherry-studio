import i18n from '@renderer/i18n'

export type PaintingGenerateErrorCode =
  | 'NO_API_KEY'
  | 'PROVIDER_DISABLED'
  | 'PROMPT_REQUIRED'
  | 'TEXT_DESC_REQUIRED'
  | 'IMAGE_REQUIRED'
  | 'IMAGE_RETRY_REQUIRED'
  | 'EDIT_IMAGE_REQUIRED'
  | 'MISSING_REQUIRED_FIELDS'
  | 'IMAGE_HANDLE_REQUIRED'
  | 'REQ_ERROR_TOKEN'
  | 'REQ_ERROR_NO_BALANCE'
  | 'OPERATION_FAILED'
  | 'GENERATE_FAILED'
  | 'IMAGE_MIX_FAILED'
  | 'CUSTOM_SIZE_REQUIRED'
  | 'CUSTOM_SIZE_RANGE'
  | 'CUSTOM_SIZE_DIVISIBLE'
  | 'CUSTOM_SIZE_PIXELS'
  | 'REMOTE_ERROR'

export interface PaintingGenerateErrorOptions {
  message?: string
  presentation?: 'modal' | 'toast'
  severity?: 'error' | 'warning'
}

export class PaintingGenerateError extends Error {
  code: PaintingGenerateErrorCode
  presentation: 'modal' | 'toast'
  severity: 'error' | 'warning'

  constructor(code: PaintingGenerateErrorCode, options: PaintingGenerateErrorOptions = {}) {
    super(options.message || code)
    this.name = 'PaintingGenerateError'
    this.code = code
    this.presentation = options.presentation || 'modal'
    this.severity = options.severity || 'error'
  }
}

export function createPaintingGenerateError(
  code: PaintingGenerateErrorCode,
  options?: PaintingGenerateErrorOptions
): PaintingGenerateError {
  return new PaintingGenerateError(code, options)
}

export function normalizePaintingGenerateError(error: unknown): Error {
  if (error instanceof PaintingGenerateError) {
    return error
  }

  if (error instanceof Error) {
    return createPaintingGenerateError('REMOTE_ERROR', { message: error.message })
  }

  return createPaintingGenerateError('GENERATE_FAILED')
}

export function translatePaintingGenerateError(error: Error): string {
  if (!(error instanceof PaintingGenerateError)) {
    return error.message
  }

  if (error.code === 'REMOTE_ERROR') {
    return error.message || i18n.t('paintings.generate_failed')
  }

  const keyMap: Record<Exclude<PaintingGenerateErrorCode, 'REMOTE_ERROR'>, string> = {
    NO_API_KEY: 'error.no_api_key',
    PROVIDER_DISABLED: 'error.provider_disabled',
    PROMPT_REQUIRED: 'paintings.prompt_required',
    TEXT_DESC_REQUIRED: 'paintings.text_desc_required',
    IMAGE_REQUIRED: 'paintings.image_file_required',
    IMAGE_RETRY_REQUIRED: 'paintings.image_file_retry',
    EDIT_IMAGE_REQUIRED: 'paintings.edit.image_required',
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

export function presentPaintingGenerateError(error: unknown) {
  const normalized = normalizePaintingGenerateError(error)
  const message = translatePaintingGenerateError(normalized)

  if (normalized instanceof PaintingGenerateError && normalized.presentation === 'toast') {
    if (normalized.severity === 'warning') {
      window.toast.warning(message)
    } else {
      window.toast.error(message)
    }
    return
  }

  window.modal.error({
    content: message,
    centered: true
  })
}
