export interface BootConfigLoadError {
  type: 'parse_error' | 'read_error' | 'validation_error'
  message: string
  filePath: string
  rawContent?: string
  /** Keys whose values failed schema validation and were reset to defaults (validation_error only). */
  invalidKeys?: string[]
}
