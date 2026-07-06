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
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return parsed.error?.message || parsed.message || fallbackMessage
  } catch {
    return text.slice(0, 300) || fallbackMessage
  }
}
