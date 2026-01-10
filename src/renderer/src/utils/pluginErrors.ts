import type { PluginError } from '@renderer/types/plugin'

/**
 * Unified error message extractor for PluginError union type.
 * Handles all plugin error types with user-friendly messages.
 *
 * @param error - The PluginError union type
 * @param defaultMessage - Default message if error cannot be parsed
 * @returns User-friendly error message
 */
export function getPluginErrorMessage(error: PluginError | undefined, defaultMessage: string): string {
  if (!error) return defaultMessage

  // Specific error type messages (for ZIP upload and package operations)
  const errorMessages: Record<string, string | ((e: PluginError) => string)> = {
    PLUGIN_MANIFEST_NOT_FOUND: 'plugin.json not found in .claude-plugin/',
    PLUGIN_MANIFEST_INVALID: (e) => `Invalid plugin.json: ${(e as { reason?: string }).reason || ''}`,
    EMPTY_PLUGIN_PACKAGE: 'Plugin package has no valid components',
    SKILL_MD_NOT_FOUND: 'SKILL.md not found in ZIP',
    INVALID_ZIP_FORMAT: (e) => `Invalid ZIP format: ${(e as { reason?: string }).reason || ''}`,
    ZIP_EXTRACTION_FAILED: (e) => `Failed to extract ZIP: ${(e as { reason?: string }).reason || ''}`,
    INVALID_WORKDIR: 'Please set agent working directory first',
    FILE_NOT_FOUND: 'File not found',
    PLUGIN_PACKAGE_NOT_FOUND: (e) => `Plugin package "${(e as { packageName?: string }).packageName || ''}" not found`,
    PLUGIN_NOT_INSTALLED: 'Plugin is not installed',
    PERMISSION_DENIED: 'Permission denied',
    WORKDIR_NOT_FOUND: 'Working directory not found or not accessible',
    INVALID_FILE_TYPE: 'Invalid file type',
    FILE_TOO_LARGE: 'File is too large',
    TRANSACTION_FAILED: (e) => `Operation failed: ${(e as { reason?: string }).reason || ''}`
  }

  // Check for specific error type first
  if (error.type && error.type in errorMessages) {
    const handler = errorMessages[error.type]
    return typeof handler === 'function' ? handler(error) : handler
  }

  // Fallback: check for common properties
  if ('message' in error && error.message) return error.message
  if ('reason' in error) return (error as { reason: string }).reason
  if ('path' in error) return `Error with file: ${(error as { path: string }).path}`

  // Last resort: use error type or default message
  return error.type || defaultMessage
}
