import { classifyError } from '@renderer/utils/errorClassifier'

type Translate = (key: string) => string
const TRANSLATE_ERROR_KEY_PATTERN = /^translate\.error\.[a-zA-Z0-9_.-]+$/

/** A localized message for the surface; the raw error is only reachable through Details. */
export function getSelectionActionErrorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof Error)) return t('error.diagnosis.unknown')
  if (TRANSLATE_ERROR_KEY_PATTERN.test(error.message)) return t(error.message)

  const classification = classifyError({ name: error.name, message: error.message, stack: error.stack ?? null })
  return classification.category === 'unknown' ? t('error.diagnosis.unknown') : t(classification.i18nKey)
}
