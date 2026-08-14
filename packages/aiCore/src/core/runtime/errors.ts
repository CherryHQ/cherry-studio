/**
 * Error classes for runtime operations
 */

/**
 * Error thrown when image generation fails
 */
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public modelId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ImageGenerationError'

    // Maintain proper stack trace (for V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ImageGenerationError)
    }
  }
}

/**
 * Error thrown when model resolution fails during image generation
 */
export class ImageModelResolutionError extends ImageGenerationError {
  constructor(modelId: string, providerId?: string, cause?: Error) {
    super(
      `Failed to resolve image model: ${modelId}${providerId ? ` for provider: ${providerId}` : ''}`,
      providerId,
      modelId,
      cause
    )
    this.name = 'ImageModelResolutionError'
  }
}
