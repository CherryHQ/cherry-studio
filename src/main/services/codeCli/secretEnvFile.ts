import { randomUUID } from 'node:crypto'
import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { posixQuote } from './shellQuote'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_ENV_FILE_EXTENSION = '.env'
const DEFAULT_STALE_AFTER_MS = 60 * 60_000

/** One launch's owner-only credential file: imported once by that launch's shell, then deleted. */
export interface SecretEnvFile {
  readonly path: string
  /** Variables the file defines; the launch aborts if any is missing after the import. */
  readonly requiredNames: readonly string[]
  /** Variables the shell clears before the import, whether or not the file defines them. */
  readonly clearNames: readonly string[]
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Writes `env` as `NAME=value` lines to a fresh `<uuid>.env` in `dir` (mode 0600). Every launch
 * gets its own file, so a later launch can never change what an earlier, still-pending launch
 * imports. `clearNames` lists variables the shell must unset even when `env` omits them, so an
 * ambient value cannot survive into the CLI.
 */
export async function createSecretEnvFile(
  dir: string,
  env: Record<string, string>,
  clearNames: readonly string[]
): Promise<SecretEnvFile> {
  const entries = Object.entries(env)
  if (entries.length === 0) throw new Error('Secret environment file requires at least one variable')
  for (const [key, value] of entries) {
    if (!ENV_NAME_PATTERN.test(key)) throw new Error(`Invalid secret environment variable name: ${key}`)
    if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
      throw new Error(`Secret environment variable ${key} contains an unsupported line break`)
    }
  }
  const requiredNames = entries.map(([key]) => key)
  const filePath = AbsoluteFilePathSchema.parse(path.join(dir, `${randomUUID()}${SECRET_ENV_FILE_EXTENSION}`))

  await atomicWriteFile(filePath, `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 })
  return { path: filePath, requiredNames, clearNames: [...new Set([...clearNames, ...requiredNames])] }
}

/** Removes a launch's file that no shell will import because the terminal never started. */
export async function removeSecretEnvFile(file: SecretEnvFile): Promise<void> {
  try {
    await unlink(file.path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

/** Removes `.env` files in `dir` older than `staleAfterMs` — launches whose shell never imported them. */
export async function removeStaleSecretEnvFiles(dir: string, staleAfterMs = DEFAULT_STALE_AFTER_MS): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }

  const cutoff = Date.now() - staleAfterMs
  for (const name of names) {
    if (!name.endsWith(SECRET_ENV_FILE_EXTENSION)) continue
    const filePath = path.join(dir, name)
    try {
      if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

/**
 * Wraps `command` so a subshell clears `clearNames`, imports the file, verifies `requiredNames`,
 * deletes the file, and only then runs `command`. The credentials vanish with the subshell.
 */
export function wrapPosixCommandWithSecretEnv(file: SecretEnvFile, command: string): string {
  const quotedPath = posixQuote(file.path)
  const reader = `while IFS= read -r _cherry_secret_env; do export "$_cherry_secret_env"; done < ${quotedPath}`
  const presenceChecks = file.requiredNames.map((name) => `[ "\${${name}+x}" = x ]`).join(' && ')
  return `(set +x; unset ${file.clearNames.join(' ')} && ${reader} && ${presenceChecks} && rm -f ${quotedPath} && unset _cherry_secret_env && ${command})`
}

/**
 * The .bat counterpart: clear, import, `goto :<missing>` for a missing variable, delete the file,
 * `goto :<undeleted>` if it is still there. Delayed expansion is switched off first, or a host
 * that enables it (`cmd /v:on`, registry) rewrites every `!…!` inside a value.
 */
export function batchLinesReadingSecretEnv(
  file: SecretEnvFile,
  labels: { readonly missing: string; readonly undeleted: string }
): string[] {
  const quotedPath = `"${file.path.replace(/%/g, '%%')}"`
  return [
    'setlocal EnableExtensions DisableDelayedExpansion',
    ...file.clearNames.map((name) => `set "${name}="`),
    `for /f "usebackq tokens=1,* delims==" %%a in (${quotedPath}) do set "%%a=%%b"`,
    ...file.requiredNames.map((name) => `if not defined ${name} goto :${labels.missing}`),
    `del /f /q ${quotedPath}`,
    `if exist ${quotedPath} goto :${labels.undeleted}`
  ]
}
