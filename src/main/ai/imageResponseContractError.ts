/**
 * The image provider finished the call (HTTP 200) but returned nothing usable. The operation may
 * already have been billed, so callers must not retry it automatically.
 */
export class ImageResponseContractError extends Error {
  override readonly name = 'ImageResponseContractError'
  readonly statusCode?: number

  constructor(message: string, options: { cause: unknown; statusCode?: number }) {
    super(message, { cause: options.cause })
    if (options.statusCode !== undefined) this.statusCode = options.statusCode
  }
}

export function isImageResponseContractError(error: unknown): error is ImageResponseContractError {
  return error instanceof ImageResponseContractError
}
