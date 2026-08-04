const skillImportErrorCodes = {
  DESCRIPTOR_MISSING: 'descriptor_missing',
  NAME_CONFLICT: 'name_conflict',
  ZIP_TOO_LARGE: 'zip_too_large',
  ZIP_TOO_MANY_FILES: 'zip_too_many_files'
} as const

type SkillImportErrorCode = (typeof skillImportErrorCodes)[keyof typeof skillImportErrorCodes]
type SkillImportTarget = { kind: 'zip' | 'directory'; name: string }
type SkillImportErrorKey =
  | 'settings.skills.directoryImportFailed'
  | 'settings.skills.importConflict'
  | 'settings.skills.installFailed'
  | 'settings.skills.zipImportFailed'
  | 'settings.skills.zipTooLarge'
  | 'settings.skills.zipTooManyFiles'
type TranslateSkillImportError = (key: SkillImportErrorKey, options: { name: string }) => string

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return ''
}

function classifySkillImportError(error: unknown): SkillImportErrorCode | null {
  const message = errorMessage(error)

  if (
    message.includes('SKILL.md or skill.md not found') ||
    message.includes('No SKILL.md found') ||
    message.includes('No skill directory found')
  ) {
    return skillImportErrorCodes.DESCRIPTOR_MISSING
  }

  if (
    message.includes('refusing to overwrite') ||
    message.includes('conflicts with an existing library directory') ||
    message.includes('conflicts with library directory')
  ) {
    return skillImportErrorCodes.NAME_CONFLICT
  }

  if (message.startsWith('ZIP too large:')) return skillImportErrorCodes.ZIP_TOO_LARGE
  if (message.startsWith('ZIP has too many files:')) return skillImportErrorCodes.ZIP_TOO_MANY_FILES

  return null
}

export function getSkillImportErrorMessage(
  error: unknown,
  target: SkillImportTarget,
  t: TranslateSkillImportError
): string {
  switch (classifySkillImportError(error)) {
    case skillImportErrorCodes.DESCRIPTOR_MISSING:
      return t(
        target.kind === 'directory' ? 'settings.skills.directoryImportFailed' : 'settings.skills.zipImportFailed',
        { name: target.name }
      )
    case skillImportErrorCodes.NAME_CONFLICT:
      return t('settings.skills.importConflict', { name: target.name })
    case skillImportErrorCodes.ZIP_TOO_LARGE:
      return t('settings.skills.zipTooLarge', { name: target.name })
    case skillImportErrorCodes.ZIP_TOO_MANY_FILES:
      return t('settings.skills.zipTooManyFiles', { name: target.name })
    default:
      return t('settings.skills.installFailed', { name: target.name })
  }
}
