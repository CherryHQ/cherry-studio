import i18next from 'i18next'

/**
 * Reads a human-readable error message from a failed `Response`.
 *
 * @param response The failed fetch response.
 * @param fallbackKey Optional i18next key used as the fallback message. When
 *   omitted the fallback is `HTTP <status>` (newapi behavior); when provided
 *   the fallback is `i18next.t(fallbackKey)` (aihubmix behavior).
 */
export async function readErrorMessage(response: Response, fallbackKey?: string): Promise<string> {
  const fallback = fallbackKey ? i18next.t(fallbackKey) : `HTTP ${response.status}`
  const text = await response.text().catch(() => '')
  if (!text) {
    return fallback
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return parsed.error?.message || parsed.message || fallback
  } catch {
    return text.slice(0, 300) || fallback
  }
}
