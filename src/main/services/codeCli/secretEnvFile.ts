import { atomicWriteFile } from '@main/utils/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { posixQuote } from './shellQuote'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** An owner-only dotenv file holding launch credentials, plus the variable names it must define. */
export interface SecretEnvFile {
  readonly path: string
  readonly names: readonly string[]
}

/**
 * Writes `env` as `NAME=value` lines with mode 0600, replacing any previous file, so a launch
 * command can carry the path instead of the values (terminal arguments, AppleScript, .bat files,
 * shell history, and the clipboard all keep copies of the command).
 */
export async function writeSecretEnvFile(
  target: AbsoluteFilePath,
  env: Record<string, string>
): Promise<SecretEnvFile> {
  const entries = Object.entries(env)
  if (entries.length === 0) throw new Error('Secret environment file requires at least one variable')
  for (const [key, value] of entries) {
    if (!ENV_NAME_PATTERN.test(key)) throw new Error(`Invalid secret environment variable name: ${key}`)
    if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
      throw new Error(`Secret environment variable ${key} contains an unsupported line break`)
    }
  }

  await atomicWriteFile(target, `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 })
  return { path: target, names: entries.map(([key]) => key) }
}

/**
 * Wraps `command` so the shell exports the file's records into a subshell first; an ambient value
 * cannot stand in for a missing record, and the credentials vanish with the subshell.
 */
export function wrapPosixCommandWithSecretEnv(file: SecretEnvFile, command: string): string {
  const reader = `while IFS= read -r _cherry_secret_env; do export "$_cherry_secret_env"; done < ${posixQuote(file.path)}`
  const presenceChecks = file.names.map((name) => `[ "\${${name}+x}" = x ]`).join(' && ')
  return `(set +x; unset ${file.names.join(' ')} && ${reader} && ${presenceChecks} && unset _cherry_secret_env && ${command})`
}

/** The .bat counterpart: clear, import, then `goto :<missingLabel>` for any record that did not load. */
export function batchLinesReadingSecretEnv(file: SecretEnvFile, missingLabel: string): string[] {
  return [
    ...file.names.map((name) => `set "${name}="`),
    `for /f "usebackq tokens=1,* delims==" %%a in ("${file.path.replace(/%/g, '%%')}") do set "%%a=%%b"`,
    ...file.names.map((name) => `if not defined ${name} goto :${missingLabel}`)
  ]
}
