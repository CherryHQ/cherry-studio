import { redactSecretText } from './redaction'

const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500
const NON_ACTIONABLE_PROVIDER_TEXT = new Set(['null', 'undefined', '[object object]', '{}', '[]'])

interface ProviderErrorSource {
  message?: unknown
  responseBody?: unknown
  data?: unknown
}

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
