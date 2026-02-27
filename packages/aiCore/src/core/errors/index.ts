/**
 * AI Core Error System
 * Unified error handling for the AI Core package
 */

/**
 * Base error class for all AI Core errors
 * Provides structured error information with error codes, context, and cause tracking
 */
export class AiCoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'AiCoreError'

    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message
          }
        : undefined
    }
  }
}

/**
 * Recursive depth limit exceeded error
 * Thrown when recursive calls exceed the maximum allowed depth
 */
export class RecursiveDepthError extends AiCoreError {
  constructor(requestId: string, currentDepth: number, maxDepth: number) {
    super('RECURSIVE_DEPTH_EXCEEDED', `Maximum recursive depth (${maxDepth}) exceeded at depth ${currentDepth}`, {
      requestId,
      currentDepth,
      maxDepth
    })
    this.name = 'RecursiveDepthError'
  }
}

/**
 * Model resolution failure error
 * Thrown when a model ID cannot be resolved to a model instance
 */
export class ModelResolutionError extends AiCoreError {
  constructor(modelId: string, providerId: string, cause?: Error) {
    super('MODEL_RESOLUTION_FAILED', `Failed to resolve model: ${modelId}`, { modelId, providerId }, cause)
    this.name = 'ModelResolutionError'
  }
}

/**
 * Parameter validation error
 * Thrown when request parameters fail validation
 */
export class ParameterValidationError extends AiCoreError {
  constructor(paramName: string, reason: string, value?: unknown) {
    super('PARAMETER_VALIDATION_FAILED', `Invalid parameter '${paramName}': ${reason}`, {
      paramName,
      reason,
      value
    })
    this.name = 'ParameterValidationError'
  }
}

/**
 * Plugin execution error
 * Thrown when a plugin fails during execution
 */
export class PluginExecutionError extends AiCoreError {
  constructor(pluginName: string, hookName: string, cause: Error) {
    super(
      'PLUGIN_EXECUTION_FAILED',
      `Plugin '${pluginName}' failed in hook '${hookName}'`,
      {
        pluginName,
        hookName
      },
      cause
    )
    this.name = 'PluginExecutionError'
  }
}

/**
 * Provider configuration error
 * Thrown when provider settings are invalid or missing
 */
export class ProviderConfigError extends AiCoreError {
  constructor(providerId: string, reason: string) {
    super('PROVIDER_CONFIG_ERROR', `Provider '${providerId}' configuration error: ${reason}`, {
      providerId,
      reason
    })
    this.name = 'ProviderConfigError'
  }
}

/**
 * Template loading error
 * Thrown when a template cannot be loaded
 */
export class TemplateLoadError extends AiCoreError {
  constructor(templateName: string, cause?: Error) {
    super('TEMPLATE_LOAD_FAILED', `Failed to load template: ${templateName}`, { templateName }, cause)
    this.name = 'TemplateLoadError'
  }
}
