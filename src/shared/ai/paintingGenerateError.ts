/**
 * Presentation-free core of the painting-generation error type.
 *
 * Lives in `@shared` so it can be thrown from main-process image transports
 * AND constructed/normalized in the renderer. The i18n translation and
 * toast/modal presentation helpers stay renderer-side in
 * `@renderer/aiCore/errors/paintingGenerateError`, which re-exports this core.
 */

export const PAINTING_GENERATE_ERROR_CODES = [
  'PROVIDER_DISABLED',
  'PROMPT_REQUIRED',
  'TEXT_DESC_REQUIRED',
  'IMAGE_REQUIRED',
  'IMAGE_RETRY_REQUIRED',
  'EDIT_IMAGE_REQUIRED',
  'INPUT_IMAGE_LIMIT_EXCEEDED',
  'MISSING_REQUIRED_FIELDS',
  'IMAGE_HANDLE_REQUIRED',
  'REQ_ERROR_TOKEN',
  'REQ_ERROR_NO_BALANCE',
  'OPERATION_FAILED',
  'GENERATE_FAILED',
  'IMAGE_MIX_FAILED',
  'CUSTOM_SIZE_REQUIRED',
  'CUSTOM_SIZE_RANGE',
  'CUSTOM_SIZE_DIVISIBLE',
  'CUSTOM_SIZE_PIXELS',
  'REMOTE_ERROR'
] as const

export type PaintingGenerateErrorCode = (typeof PAINTING_GENERATE_ERROR_CODES)[number]

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

const PAINTING_GENERATE_ERROR_CODE_SET: ReadonlySet<string> = new Set(PAINTING_GENERATE_ERROR_CODES)
const WIRE_PREFIX = 'PaintingGenerateError:'

/**
 * Encode a main-process painting error for the image job, which keeps only an error message across the
 * job and IPC boundary. The prefix keeps the code apart from any vendor text, so a vendor message that
 * happens to equal a code is never read as that code.
 */
export function encodePaintingGenerateError(error: PaintingGenerateError): string {
  const message = error.message === error.code ? '' : error.message
  return `${WIRE_PREFIX}${error.code}:${message}`
}

/** Rebuild a painting error encoded by `encodePaintingGenerateError`, or `undefined` for any other text. */
export function decodePaintingGenerateError(message: unknown): PaintingGenerateError | undefined {
  if (typeof message !== 'string' || !message.startsWith(WIRE_PREFIX)) return undefined
  const rest = message.slice(WIRE_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator < 0) return undefined
  const code = rest.slice(0, separator)
  if (!PAINTING_GENERATE_ERROR_CODE_SET.has(code)) return undefined
  const text = rest.slice(separator + 1)
  return createPaintingGenerateError(code as PaintingGenerateErrorCode, text ? { message: text } : undefined)
}

export function normalizePaintingGenerateError(error: unknown): Error {
  if (error instanceof PaintingGenerateError) {
    return error
  }

  if (error instanceof Error) {
    return (
      decodePaintingGenerateError(error.message) ??
      createPaintingGenerateError('REMOTE_ERROR', { message: error.message })
    )
  }

  return createPaintingGenerateError('GENERATE_FAILED')
}
