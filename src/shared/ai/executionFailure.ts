import {
  executionFailureSchema,
  type AiFailureReason,
  type ExecutionFailure
} from '@cherrystudio/remote-protocol/failure'

import type { SerializedError } from '../types/error'
import { classifyErrorCategory, extractHttpStatus, isErrorCategory, type ErrorCategory } from '../utils/errorCategory'
import { getSafeProviderErrorMessage } from './providerError'

const reasons: Partial<Record<ErrorCategory, AiFailureReason>> = {
  auth: 'auth',
  permission: 'permission',
  region: 'region',
  model: 'model_not_found',
  quota: 'quota',
  rate_limit: 'rate_limit',
  context_length: 'context_length',
  payload: 'payload_too_large',
  network: 'network',
  proxy: 'proxy_tls',
  stream: 'stream_interrupted',
  content: 'content_filter',
  server: 'provider_unavailable',
  mcp: 'mcp',
  parse: 'parse',
  unknown: 'unknown'
}

function safeText(value: unknown, limit: number): string | undefined {
  const text = getSafeProviderErrorMessage({ message: value }).replace(
    /(?:\/(?:Users|home|private|tmp|var|Volumes)\/|[A-Za-z]:\\)[^\s"']+/g,
    '<path>'
  )
  return text ? Array.from(text).slice(0, limit).join('') : undefined
}

export function toExecutionFailure(
  error: SerializedError,
  modelId?: string,
  layer?: ExecutionFailure['failure']['source']['layer']
): ExecutionFailure {
  const stored = executionFailureSchema.safeParse(error.executionFailure)
  if (stored.success && !layer) return stored.data
  const raw = typeof error.message === 'string' ? error.message : ''
  const status = typeof error.statusCode === 'number' ? error.statusCode : extractHttpStatus(raw)
  const category = isErrorCategory(error.providerErrorCategory)
    ? error.providerErrorCategory
    : isErrorCategory(error.claudeCodeExitCategory)
      ? error.claudeCodeExitCategory
      : classifyErrorCategory({ text: raw, status })
  const message =
    safeText(
      getSafeProviderErrorMessage({
        message: raw,
        responseBody: error.responseBody ?? raw.replace(/^\s*\d{3}:\s*/, ''),
        data: error.data
      }),
      500
    ) ?? 'Execution failed'
  const reasonCode = layer === 'host' ? 'internal' : (reasons[category] ?? 'unknown')
  const providerId = safeText(error.providerId ?? modelId?.split('::')[0], 128)
  const model = safeText(modelId ?? error.modelId, 128)
  const value: ExecutionFailure = {
    message,
    retryable: error.isRetryable === true && !['auth', 'permission', 'quota', 'internal'].includes(reasonCode),
    failure: {
      version: 1,
      reasonCode,
      source: { layer: layer ?? (status || error.providerErrorCategory ? 'provider' : 'runtime') },
      context: {
        ...(status && status >= 100 && status <= 599 ? { statusCode: status } : {}),
        ...(providerId ? { providerId } : {}),
        ...(model ? { modelId: model } : {})
      }
    }
  }
  while (new TextEncoder().encode(JSON.stringify(value)).length > 4096)
    value.message = Array.from(value.message)
      .slice(0, Math.floor(Array.from(value.message).length / 2))
      .join('')
  return value
}
