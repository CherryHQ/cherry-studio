/**
 * Validator configuration for real-time input validation
 */
export interface ValidatorConfig {
  /** Validation function, returns error message or null */
  validate?: (value: string) => string | null
  /** Transform input value (e.g., lowercase, remove invalid chars) */
  transform?: (value: string) => string
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number
}

/**
 * Compose multiple validators into one
 *
 * @example
 * ```ts
 * const validator = composeValidators(
 *   validators.urlSafe(32),
 *   { validate: (v) => v.startsWith('-') ? 'Cannot start with hyphen' : null }
 * )
 * ```
 */
export function composeValidators(...configs: ValidatorConfig[]): ValidatorConfig {
  return {
    // Chain transforms: apply each transform in order
    transform: (value) => {
      return configs.reduce((v, config) => (config.transform ? config.transform(v) : v), value)
    },

    // Chain validates: return first error found
    validate: (value) => {
      for (const config of configs) {
        if (config.validate) {
          const error = config.validate(value)
          if (error) return error
        }
      }
      return null
    },

    // Use the smallest non-zero debounce
    debounceMs: configs.reduce((min, config) => {
      if (config.debounceMs && (min === 0 || config.debounceMs < min)) {
        return config.debounceMs
      }
      return min
    }, 0)
  }
}

/**
 * Validation error i18n keys
 * These keys should be translated in the UI layer using t() function
 */
export const ValidationErrorKeys = {
  NAME_REQUIRED: 'validation.name_required',
  FIELD_REQUIRED: 'validation.field_required',
  FILE_NAME_REQUIRED: 'validation.file_name_required'
} as const

/**
 * Preset validators for common use cases
 * Note: Validators return i18n keys, UI layer should translate them
 */
export const validators = {
  /**
   * URL-safe characters validator (for API paths, slugs, etc.)
   * - Auto lowercase
   * - Only allow a-z, 0-9, and hyphen
   * - Limit to maxLength characters
   */
  urlSafe: (maxLength = 32): ValidatorConfig => ({
    transform: (v) =>
      v
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, maxLength),
    validate: (v) => (!v ? ValidationErrorKeys.NAME_REQUIRED : null),
    debounceMs: 300
  }),

  /**
   * Required field validator (non-empty after trim)
   */
  required: (): ValidatorConfig => ({
    validate: (v) => (!v.trim() ? ValidationErrorKeys.FIELD_REQUIRED : null)
  }),

  /**
   * Max length validator
   * Note: Since transform already limits length, validate won't trigger
   */
  maxLength: (max: number): ValidatorConfig => ({
    transform: (v) => v.slice(0, max)
  }),

  /**
   * Universal file name validator (works across all platforms)
   * - Removes characters invalid on Windows/macOS/Linux
   * - Removes trailing spaces and dots
   * - Limits to maxLength characters
   */
  fileName: (maxLength = 255): ValidatorConfig => ({
    transform: (v) =>
      v

        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Invalid on Windows + null/control chars
        .replace(/[\s.]+$/, '') // Remove trailing spaces and dots
        .slice(0, maxLength),
    validate: (v) => (!v.trim() ? ValidationErrorKeys.FILE_NAME_REQUIRED : null),
    debounceMs: 300
  })
}
