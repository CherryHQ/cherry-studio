/**
 * Reads a human-readable error message from a failed `Response`.
 *
 * @param response The failed fetch response.
 * @param fallback Optional pre-translated fallback message. When omitted the
 *   fallback is `HTTP <status>` (newapi behavior); when provided it is used
 *   verbatim — callers pass an already-localized string (e.g. main's `t(...)`).
 */
export async function readErrorMessage(response: Response, fallback?: string): Promise<string> {
  const fallbackMessage = fallback ?? `HTTP ${response.status}`
  const text = await response.text().catch(() => '')

  if (!text) {
    return fallbackMessage
  }

  try {
    const parsed: unknown = JSON.parse(text)

    if (typeof parsed !== 'object' || parsed === null) return fallbackMessage
    const error = 'error' in parsed ? parsed.error : undefined
    const nestedMessage = error !== null && typeof error === 'object' && 'message' in error ? error.message : undefined

    if (typeof nestedMessage === 'string' && nestedMessage) return nestedMessage
    const message = 'message' in parsed ? parsed.message : undefined

    return typeof message === 'string' && message ? message : fallbackMessage
  } catch {
    return text.slice(0, 300) || fallbackMessage
  }
}
