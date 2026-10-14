import { AISDKError, APICallError, RetryError } from 'ai'

import type { SerializedError } from '../types/error'
import type { Serializable } from '../types/serializable'
import { classifyErrorCategory } from '../utils/errorCategory'
import { redactSecretText } from '../utils/redaction'

const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500
const MAX_PROVIDER_ERROR_INPUT_LENGTH = 16_384
const MAX_PROVIDER_ERROR_DECODE_DEPTH = 3
const MAX_NESTED_PROVIDER_ERROR_DEPTH = 5
const NON_ACTIONABLE_PROVIDER_TEXT = new Set(['null', 'undefined', '[object object]', '{}', '[]'])
const HTML_DOCUMENT_PATTERN = /(?:<!doctype\s+html\b|<html(?:\s|>))/i
const JSON_CONTAINER_PATTERN = /\{\s*(?:["'{[]|\}|[^\s{}[\],:]+\s*:)|\[(?!\s*\d+(?:\s*,\s*\d+)*\s*\])[^\]]*(?:\]|$)/i

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

function containsEncodedContainer(text: string): boolean {
  let candidate = text.trimStart()
  while (candidate.startsWith('"') || candidate.startsWith("'") || candidate.startsWith('\\')) {
    candidate = candidate.slice(1).trimStart()
  }
  return JSON_CONTAINER_PATTERN.test(candidate) || HTML_DOCUMENT_PATTERN.test(candidate)
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
      if (containsEncodedContainer(text)) return ''
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

function providerErrorCodes(value: unknown, decodeDepth = 0): string {
  if (typeof value === 'string') {
    if (value.length > MAX_PROVIDER_ERROR_INPUT_LENGTH || decodeDepth >= MAX_PROVIDER_ERROR_DECODE_DEPTH) return ''
    try {
      return providerErrorCodes(JSON.parse(value), decodeDepth + 1)
    } catch {
      return ''
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const payload = value as Record<string, unknown>
  const detail =
    payload.detail && typeof payload.detail === 'object' ? (payload.detail as Record<string, unknown>) : null
  return [payload, payload.error, detail, detail?.error]
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const record = entry as Record<string, unknown>
      return [record.code, record.type].filter(
        (code): code is string => typeof code === 'string' && code.length <= MAX_PROVIDER_ERROR_MESSAGE_LENGTH
      )
    })
    .join('\n')
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

function serializeNestedAiSdkError(error: AISDKError, depth: number): SerializedError {
  const source = error as unknown as Record<string, unknown>
  const serialized: SerializedError = {
    name: getSafeProviderErrorMessage({ message: error.name }),
    message: getSafeProviderErrorMessage({ message: error.message }),
    stack: null,
    cause: null,
    ...getSafeAiSdkErrorDiscriminants(source)
  }

  if (RetryError.isInstance(error)) {
    serialized.lastError = serializeNestedProviderErrorAtDepth(error.lastError, depth + 1)
    serialized.errors = error.errors.map((nested) => serializeNestedProviderErrorAtDepth(nested, depth + 1))
  }

  return serialized
}

function serializeNestedProviderErrorAtDepth(value: unknown, depth: number): Serializable {
  if (depth >= MAX_NESTED_PROVIDER_ERROR_DEPTH) return null
  if (APICallError.isInstance(value)) {
    const message = getSafeProviderErrorMessage(value)
    return {
      name: value.name,
      message,
      providerErrorCategory: classifyErrorCategory({
        text: [message, providerErrorCodes(value.responseBody), providerErrorCodes(value.data)].join('\n'),
        status: value.statusCode
      }),
      stack: null,
      cause: null,
      url: '',
      requestBodyValues: null,
      statusCode: value.statusCode ?? null,
      responseHeaders: null,
      responseBody: null,
      isRetryable: value.isRetryable,
      data: null
    }
  }
  if (AISDKError.isInstance(value)) return serializeNestedAiSdkError(value, depth)
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

export function serializeNestedProviderError(value: unknown): Serializable {
  return serializeNestedProviderErrorAtDepth(value, 0)
}
