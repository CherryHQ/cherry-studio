import type { Serializable } from '../types/serializable'
import { redactSecretText } from './redaction'

const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500
const NON_ACTIONABLE_PROVIDER_TEXT = new Set(['null', 'undefined', '[object object]', '{}', '[]'])

interface ProviderErrorSource {
  message?: unknown
  responseBody?: unknown
  data?: unknown
}

const SAFE_AI_SDK_STRING_FIELDS = [
  'statusText',
  'parameter',
  'role',
  'toolName',
  'modelId',
  'modelType',
  'providerId',
  'reason',
  'functionality',
  'provider',
  'finishReason'
] as const

function actionableText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text && !NON_ACTIONABLE_PROVIDER_TEXT.has(text.toLowerCase()) ? redactSecretText(text) : ''
}

function payloadText(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return payloadText(JSON.parse(value))
    } catch {
      return ''
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  const payload = value as Record<string, unknown>
  const error = payload.error && typeof payload.error === 'object' ? (payload.error as Record<string, unknown>) : null
  const detail =
    payload.detail && typeof payload.detail === 'object' ? (payload.detail as Record<string, unknown>) : null
  const detailError =
    detail?.error && typeof detail.error === 'object' ? (detail.error as Record<string, unknown>) : null

  return (
    [error?.message, payload.message, detailError?.message, detail?.message, payload.detail, payload.msg, payload.error]
      .map(actionableText)
      .find(Boolean) ?? ''
  )
}

export function getSafeProviderErrorMessage(source: ProviderErrorSource): string {
  const text = payloadText(source.responseBody) || payloadText(source.data) || actionableText(source.message)
  return text.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH)}…` : text
}

export function getSafeAiSdkErrorDiscriminants(source: Record<string, unknown>): Record<string, Serializable> {
  const discriminants: Record<string, Serializable> = {}

  for (const field of SAFE_AI_SDK_STRING_FIELDS) {
    if (typeof source[field] === 'string') {
      discriminants[field] = getSafeProviderErrorMessage({ message: source[field] })
    }
  }
  for (const field of ['availableProviders', 'availableTools'] as const) {
    const value = source[field]
    if (value === null) discriminants[field] = null
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      discriminants[field] = value.map((item) => getSafeProviderErrorMessage({ message: item }))
    }
  }
  for (const field of ['statusCode', 'maxEmbeddingsPerCall'] as const) {
    const value = source[field]
    if (value === null || typeof value === 'number') discriminants[field] = value
  }
  if (typeof source.isRetryable === 'boolean') discriminants.isRetryable = source.isRetryable

  return discriminants
}
