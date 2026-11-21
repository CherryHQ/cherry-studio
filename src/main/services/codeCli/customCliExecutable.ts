import fs from 'node:fs'
import path from 'node:path'

import type { CustomCliErrorCode } from '@shared/types/codeCli'

/**
 * Validation for a user-registered custom Code CLI executable (issue #19966,
 * spec note 2026-11-17-custom-code-cli-executable). Runs in the main process
 * when the Agent is saved and again before each launch; the renderer maps the
 * typed error code to a translated, actionable message.
 */

export type CustomCliValidation = { ok: true; resolvedPath: string } | { ok: false; code: CustomCliErrorCode }

/** Extensions the Windows OS can launch directly, without cmd.exe parsing. */
const WINDOWS_LAUNCHABLE_EXTENSIONS = new Set(['.exe', '.com'])

/**
 * Pure string-form checks: absolute path and, on Windows, a directly
 * launchable extension. Batch wrappers (`.cmd`, `.bat`) and scripts are
 * rejected because launching them requires `cmd.exe` argument parsing.
 * Split from the filesystem checks so Windows path behavior is unit-testable
 * on any host.
 */
export function validateCustomCliPathForm(
  executable: string,
  platform: NodeJS.Platform = process.platform
): CustomCliValidation {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  // A relative or empty path cannot be resolved to a stable launch target;
  // report it as `missing`, the same code a moved executable produces.
  if (!executable || !pathApi.isAbsolute(executable)) return { ok: false, code: 'missing' }
  const resolvedPath = pathApi.normalize(executable)
  if (platform === 'win32' && !WINDOWS_LAUNCHABLE_EXTENSIONS.has(pathApi.extname(resolvedPath).toLowerCase())) {
    return { ok: false, code: 'unsupported_extension' }
  }
  return { ok: true, resolvedPath }
}

/**
 * Full validation: path form, then that the path exists, is a regular file,
 * and is executable (`X_OK` on POSIX; the extension check is the Windows
 * gate). Synchronous on purpose: Agent save is synchronous and launch holds
 * no other work, and the checked path is a single local file.
 */
export function validateCustomCliExecutable(
  executable: string,
  platform: NodeJS.Platform = process.platform
): CustomCliValidation {
  const form = validateCustomCliPathForm(executable, platform)
  if (!form.ok) return form
  const { resolvedPath } = form

  let stat: fs.Stats
  try {
    stat = fs.statSync(resolvedPath)
  } catch {
    // ENOENT/ENOTDIR (missing) and EACCES on a path component alike: the
    // executable cannot be reached, so the actionable fix is the path itself.
    return { ok: false, code: 'missing' }
  }
  if (!stat.isFile()) return { ok: false, code: 'not_file' }
  if (platform !== 'win32') {
    try {
      fs.accessSync(resolvedPath, fs.constants.X_OK)
    } catch {
      return { ok: false, code: 'not_executable' }
    }
  }
  return { ok: true, resolvedPath }
}

/** Error thrown when a save or launch is attempted with an invalid custom executable. */
export class CustomCliValidationError extends Error {
  constructor(
    public readonly code: CustomCliErrorCode,
    public readonly executable: string
  ) {
    super(`Invalid custom Code CLI executable (${code}): ${executable}`)
    this.name = 'CustomCliValidationError'
  }
}

/**
 * Validate a stored `custom_cli` configuration for save or launch. Returns the
 * resolved absolute path and the stored argument vector, or throws
 * {@link CustomCliValidationError}; a caller that catches must not spawn.
 */
export function requireValidCustomCli(
  customCli: { executable: string; args: string[] },
  platform: NodeJS.Platform = process.platform
): { resolvedPath: string; args: string[] } {
  const result = validateCustomCliExecutable(customCli.executable, platform)
  if (!result.ok) throw new CustomCliValidationError(result.code, customCli.executable)
  return { resolvedPath: result.resolvedPath, args: customCli.args }
}

/**
 * Prepend a stored custom argument vector to a CLI spawn's arguments (AC3):
 * the child receives each stored string exactly, with the SDK's own arguments
 * following. No shell is involved, so quoting is never reparsed.
 */
export function prependCustomCliArgs<T extends { args: string[] }>(options: T, customCliArgs?: readonly string[]): T {
  return customCliArgs?.length ? { ...options, args: [...customCliArgs, ...options.args] } : options
}
