/**
 * Snapshot of one user-visible failure. The id is the occurrence: a later error
 * never rewrites an earlier snapshot, and a repeat of the same id is the same fault.
 */
export interface AppErrorContext {
  readonly id: string
  readonly occurredAt: string
  readonly source: string
  readonly operation: string
  readonly message: string
  readonly name?: string
  /** Present only when the producer supplied a stack. Never synthesized. */
  readonly stack?: string
  /** HTTP status from the failed call, when the producer had one. */
  readonly statusCode?: number
  /**
   * Bounded, redacted provider response. Prompts, request bodies, and credentials
   * are removed before this is stored.
   */
  readonly responseBody?: string
  readonly providerId?: string
  readonly modelId?: string
  readonly recordId?: string
  /** Non-content parameter summary. Prompts and attachments do not belong here. */
  readonly params?: Readonly<Record<string, string | number | boolean | null>>
  /** Image-only models must not run the chat conversation probe. */
  readonly imageOnly?: boolean
}

/**
 * Painting parameter names safe to keep on an error snapshot.
 * Anything else — prompts, images, and unknown vendor fields — stays out.
 */
export const PAINTING_ERROR_PARAM_KEYS = [
  'aspect_ratio',
  'guidance',
  'height',
  'mode',
  'n',
  'quality',
  'seed',
  'size',
  'steps',
  'style',
  'width'
] as const

/** Keys that carry prompt or attachment content and must not enter an error snapshot. */
export const APP_ERROR_CONTENT_PARAM_KEYS = [
  'attachment',
  'attachments',
  'image',
  'images',
  'input',
  'messages',
  'negative_prompt',
  'negativeprompt',
  'prompt',
  'prompts'
] as const
