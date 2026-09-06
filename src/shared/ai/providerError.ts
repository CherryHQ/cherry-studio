import { AISDKError, APICallError } from 'ai'

import type { SerializedError } from '../types/error'
import type { Serializable } from '../types/serializable'
import { redactSecretText } from '../utils/redaction'

const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500
const MAX_PROVIDER_ERROR_INPUT_LENGTH = 16_384
const MAX_PROVIDER_ERROR_DECODE_DEPTH = 3
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
  if (typeof value !== 'string' || value.length > MAX_PROVIDER_ERROR_INPUT_LENGTH) return ''
  const text = value.trim()
  return text && !NON_ACTIONABLE_PROVIDER_TEXT.has(text.toLowerCase()) ? redactSecretText(text) : ''
}

function startsWithEncodedContainer(text: string): boolean {
  let candidate = text.trimStart()
  while (candidate.startsWith('"') || candidate.startsWith("'") || candidate.startsWith('\\')) {
    candidate = candidate.slice(1).trimStart()
  }
  return candidate.startsWith('{') || candidate.startsWith('[')
}

function providerPayloadText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_PROVIDER_ERROR_INPUT_LENGTH) return ''
  let parsed: unknown = value
  for (let depth = 0; depth < MAX_PROVIDER_ERROR_DECODE_DEPTH && typeof parsed === 'string'; depth += 1) {
    const text = parsed
    if (text.length > MAX_PROVIDER_ERROR_INPUT_LENGTH) return ''
    try {
      parsed = JSON.parse(text)
    } catch {
      if (startsWithEncodedContainer(text)) return ''
      return actionableText(value)
    }
  }
  if (typeof parsed === 'string') return ''
  if (typeof parsed === 'object' && parsed !== null) return ''
  return actionableText(value)
}

function payloadText(value: unknown, decodeDepth = 0): string {
  if (typeof value === 'string') {
    if (value.length > MAX_PROVIDER_ERROR_INPUT_LENGTH || decodeDepth >= MAX_PROVIDER_ERROR_DECODE_DEPTH) return ''
    try {
      return payloadText(JSON.parse(value), decodeDepth + 1)
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
    [error?.message, payload.message, detailError?.message, detail?.message, payload.msg, payload.detail, payload.error]
      .map(providerPayloadText)
      .find(Boolean) ?? ''
  )
}

export function getSafeProviderErrorMessage(source: ProviderErrorSource): string {
  const text = payloadText(source.responseBody) || payloadText(source.data) || providerPayloadText(source.message)
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

function serializeNestedAiSdkError(error: AISDKError): SerializedError {
  const source = error as unknown as Record<string, unknown>
  return {
    name: getSafeProviderErrorMessage({ message: error.name }),
    message: getSafeProviderErrorMessage({ message: error.message }),
    stack: null,
    cause: null,
    ...getSafeAiSdkErrorDiscriminants(source)
  }
}

export function serializeNestedProviderError(value: unknown): Serializable {
  if (APICallError.isInstance(value)) {
    return {
      name: value.name,
      message: getSafeProviderErrorMessage(value),
      stack: null,
      cause: null,
      statusCode: value.statusCode ?? null,
      isRetryable: value.isRetryable
    }
  }
  if (AISDKError.isInstance(value)) return serializeNestedAiSdkError(value)
  if (value instanceof Error) {
    return {
      name: getSafeProviderErrorMessage({ message: value.name }),
      message: getSafeProviderErrorMessage({ message: value.message }),
      stack: null,
      cause: null
    }
  }
  return null
}
