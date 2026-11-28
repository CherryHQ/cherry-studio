import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, type LanguageModelMiddleware } from 'ai'

import { definePlugin, isContextOverflowError } from '@cherrystudio/ai-core'
import { getSafeProviderErrorMessage, ProviderContextOverflowError } from '@shared/ai/providerError'

export function normalizeProviderError(error: unknown): unknown {
  if (error instanceof ProviderContextOverflowError || !isContextOverflowError(error)) return error

  const apiError = APICallError.isInstance(error) ? error : undefined
  const payload = typeof error === 'object' && error ? (error as Record<string, unknown>) : undefined
  const statusCode = apiError
    ? apiError.statusCode
    : typeof payload?.status === 'number'
      ? payload.status
      : typeof payload?.statusCode === 'number'
        ? payload.statusCode
        : undefined
  const message = apiError
    ? apiError.message
    : getSafeProviderErrorMessage({ data: error, message: error }) || 'Context length exceeded'
  return new ProviderContextOverflowError({
    ...apiError,
    message,
    statusCode,
    url: apiError?.url ?? '',
    requestBodyValues: apiError?.requestBodyValues,
    cause: apiError?.cause,
    isRetryable: false
  })
}

export const providerErrorBoundaryMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  async wrapGenerate({ doGenerate }) {
    try {
      return await doGenerate()
    } catch (error) {
      throw normalizeProviderError(error)
    }
  },
  async wrapStream({ doStream }) {
    try {
      const result = await doStream()
      const boundary = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(part, controller) {
          controller.enqueue(part.type === 'error' ? { ...part, error: normalizeProviderError(part.error) } : part)
        }
      })
      void result.stream
        .pipeTo(boundary.writable, { preventAbort: true })
        .catch((error: unknown) => boundary.writable.abort(normalizeProviderError(error)).catch(() => {}))
      return { ...result, stream: boundary.readable }
    } catch (error) {
      throw normalizeProviderError(error)
    }
  }
}

export const providerErrorBoundaryPlugin = definePlugin({
  name: 'provider-error-boundary',
  configureContext: (context) => {
    context.middlewares ??= []
    context.middlewares.push(providerErrorBoundaryMiddleware)
  }
})
