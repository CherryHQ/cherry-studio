import { classifyError } from '@renderer/utils/errorClassifier'

type Translate = (key: string) => string

export function getSelectionActionErrorMessage(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!(error instanceof Error)) return message

  const classification = classifyError({ name: error.name, message, stack: error.stack ?? null })
  return classification.category === 'unknown' ? message : t(classification.i18nKey)
}
