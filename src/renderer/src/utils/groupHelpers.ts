/**
 * Utilities for model mention groups
 */

/**
 * Generate a stable unique id for a group.
 * Prefer `crypto.randomUUID` when available, with a safe fallback.
 */
export const generateGroupId = (): string => {
  try {
    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
      return (globalThis.crypto as Crypto).randomUUID()
    }
  } catch (_err) {
    // ignore errors (crypto not available or denied), use fallback below
    void _err
  }
  const rand = Math.random().toString(36).slice(2)
  return `g_${Date.now()}_${rand}`
}

/**
 * Validate group name for basic constraints.
 * - non-empty after trim
 * - max length 100
 * - no control characters or newlines
 */
export const validateGroupName = (name: string): boolean => {
  if (!name) return false
  const trimmed = name.trim()
  if (!trimmed) return false
  if (trimmed.length > 100) return false
  // Disallow control chars and line breaks
  if (/\p{C}/u.test(trimmed)) return false
  if (/[\r\n]/.test(trimmed)) return false
  return true
}
