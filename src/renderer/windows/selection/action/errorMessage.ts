import { serializeHealthCheckError } from '@renderer/utils/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import { readErrorMessage, toError } from '@renderer/utils/errorDetails'

type Translate = (key: string) => string

const TRANSLATE_ERROR_KEY_PATTERN = /^translate\.error\.[a-zA-Z0-9_.-]+$/

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Selection actions can reject arbitrary values; read safe diagnostic text before applying translation/error classification.
export function getSelectionActionErrorMessage(error: unknown, t: Translate): string {
  const normalized = toError(error)
  const message = readErrorMessage(normalized)

  if (normalized !== error) return message

  if (TRANSLATE_ERROR_KEY_PATTERN.test(message)) return t(message)

  const classification = classifyError(serializeHealthCheckError(normalized))

  return classification.category === 'unknown' ? message : t(classification.i18nKey)
}
