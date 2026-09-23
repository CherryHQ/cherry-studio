export type ImageConfigErrorCode =
  | 'invalid_ratio'
  | 'invalid_dimensions'
  | 'conflicting_size'
  | 'unsupported_size'
  | 'missing_dimensions'
  | 'transparent_format'
  | 'preset_required'
  | 'invalid_parameter'
  | 'invalid_config'

/** Stable codes let each UI localize validation without parsing diagnostic text. */
export class ImageConfigError extends Error {
  constructor(
    readonly code: ImageConfigErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ImageConfigError'
  }
}
