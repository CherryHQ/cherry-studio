import type { i18n } from 'i18next'

import type { SerializedError } from '@renderer/types/error'

// Verify that each translation has no tags or interpolation before adding a key.
const APP_OWNED_TOAST_KEYS = new Set(['claude_code_branch_runtime_mismatch'])

export function resolveAppOwnedError(error: SerializedError, i18n: i18n) {
  const key = error.i18nKey
  if (typeof key !== 'string' || key === '' || !APP_OWNED_TOAST_KEYS.has(key) || !i18n.exists('error.' + key)) {
    return undefined
  }
  const detailKey = error.detailI18nKey
  const fullDetailKey = typeof detailKey === 'string' ? 'error.' + detailKey : ''
  const detail =
    typeof detailKey === 'string' && detailKey !== '' && i18n.exists(fullDetailKey)
      ? i18n.t(fullDetailKey, error.detailI18nValues as Record<string, string> | undefined)
      : undefined
  return { title: i18n.t('error.' + key), detail }
}
