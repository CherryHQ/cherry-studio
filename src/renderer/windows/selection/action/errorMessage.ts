import { classifyError } from '@renderer/utils/errorClassifier'

type Translate = (key: string) => string
const TRANSLATE_ERROR_KEY_PATTERN = /^translate\.error\.[a-zA-Z0-9_.-]+$/

export function getSelectionActionErrorMessage(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!(error instanceof Error)) return message
  if (TRANSLATE_ERROR_KEY_PATTERN.test(message)) return t(message)

  const classification = classifyError({ name: error.name, message, stack: error.stack ?? null })
  return classification.category === 'unknown' ? message : t(classification.i18nKey)
}
