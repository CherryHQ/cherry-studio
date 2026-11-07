import type { ZodError } from 'zod'

import { t } from '@main/i18n'

export function formatManifestValidationError(error: ZodError, source: 'archive' | 'distribution'): string {
  const issue = error.issues[0]
  const field = issue.path.join('.')
  let body: string

  if (issue.code === 'too_big' && issue.origin === 'string' && issue.inclusive === true) {
    body = t('mini_app.manifest.text_too_long', { field, maximum: Number(issue.maximum) })
  } else if (
    issue.code === 'too_small' &&
    issue.origin === 'string' &&
    issue.minimum === 1 &&
    issue.inclusive === true
  ) {
    body = t('mini_app.manifest.text_empty', { field })
  } else if (
    issue.code === 'invalid_union' &&
    issue.path.length === 1 &&
    ['name', 'description', 'releaseNotes'].includes(field)
  ) {
    body = t('mini_app.manifest.invalid_localized_text', { field })
  } else if (field) {
    body = t('mini_app.manifest.field_issue', { field, message: issue.message })
  } else {
    body = issue.message
  }

  return source === 'archive' ? t('mini_app.manifest.package_error', { message: body }) : body
}
