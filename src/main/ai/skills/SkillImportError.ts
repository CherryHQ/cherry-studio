export type SkillImportFailureCode = 'SKILL_DIRECTORY_NOT_FOUND' | 'INVALID_ZIP_FILE' | 'DIRECTORY_NOT_FOUND'

export class SkillImportError extends Error {
  constructor(
    readonly code: SkillImportFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SkillImportError'
  }
}
