import { randomUUID } from 'node:crypto'
import { lstat, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { posixQuote } from './shellQuote'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const SECRET_ENV_ARTIFACT_PATTERN = new RegExp(`^${UUID_PATTERN}\\.env(?:\\.tmp-${UUID_PATTERN})?$`, 'i')
const DEFAULT_STALE_AFTER_MS = 60 * 60_000

export interface SecretEnvSpec {
  readonly values: Readonly<Record<string, string>>
  readonly clearNames: readonly string[]
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function validateName(name: string): void {
  if (!ENV_NAME_PATTERN.test(name)) throw new Error(`Invalid secret environment variable name: ${name}`)
}

function escapeBatchEchoText(text: string): string {
  return text
    .replace(/\^/g, '^^')
    .replace(/%/g, '%%')
    .replace(/&/g, '^&')
    .replace(/\|/g, '^|')
    .replace(/>/g, '^>')
    .replace(/</g, '^<')
    .replace(/\r?\n/g, ' ')
}

/** One launch's credential lease, consumed by exactly that launch's shell. */
export class SecretEnvHandoff {
  readonly launchId: string
  readonly path: string

  private constructor(
    launchId: string,
    filePath: string,
    private readonly requiredNames: readonly string[],
    private readonly clearNames: readonly string[]
  ) {
    this.launchId = launchId
    this.path = filePath
  }

  static async create(dir: string, spec: SecretEnvSpec): Promise<SecretEnvHandoff> {
    const entries = Object.entries(spec.values)
    if (entries.length === 0) throw new Error('Secret environment handoff requires at least one variable')

    for (const name of spec.clearNames) validateName(name)
    for (const [name, value] of entries) {
      validateName(name)
      if (value.length === 0) throw new Error(`Secret environment variable ${name} must not be empty`)
      if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
        throw new Error(`Secret environment variable ${name} contains an unsupported line break`)
      }
    }

    const launchId = randomUUID()
    const requiredNames = entries.map(([name]) => name)
    const clearNames = [...new Set([...spec.clearNames, ...requiredNames])]
    const filePath = AbsoluteFilePathSchema.parse(path.join(dir, `${launchId}.env`))

    // POSIX gets 0600; Windows relies on the userData directory's inherited per-user ACL.
    await atomicWriteFile(filePath, `${entries.map(([name, value]) => `${name}=${value}`).join('\n')}\n`, {
      mode: 0o600
    })
    return new SecretEnvHandoff(launchId, filePath, requiredNames, clearNames)
  }

  /** Removes a lease that no terminal owns, or tolerates one the shell already consumed. */
  async dispose(): Promise<void> {
    try {
      await unlink(this.path)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  /** Removes expired leases and atomic-write remnants while leaving unrelated files untouched. */
  static async removeExpired(dir: string, staleAfterMs = DEFAULT_STALE_AFTER_MS): Promise<void> {
    await SecretEnvHandoff.removeMatching(dir, Date.now() - staleAfterMs)
  }

  /** Invalidates every lease left by a previous process or by a service that is stopping. */
  static async removeAll(dir: string): Promise<void> {
    await SecretEnvHandoff.removeMatching(dir)
  }

  private static async removeMatching(dir: string, cutoff?: number): Promise<void> {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }

    const errors: unknown[] = []
    for (const name of names) {
      if (!SECRET_ENV_ARTIFACT_PATTERN.test(name)) continue
      const filePath = path.join(dir, name)
      try {
        if (cutoff === undefined || (await lstat(filePath)).mtimeMs < cutoff) await unlink(filePath)
      } catch (error) {
        if (!isMissing(error)) errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Failed to remove one or more secret environment handoffs')
  }

  /** Imports and consumes this lease inside a subshell before running `command`. */
  wrapPosixCommand(command: string): string {
    const quotedPath = posixQuote(this.path)
    const reader = `while IFS= read -r _cherry_secret_env; do export "$_cherry_secret_env" || { _cherry_secret_env_status=$?; break; }; done < ${quotedPath}`
    const presenceChecks = this.requiredNames.map((name) => `[ "\${${name}+x}" = x ]`).join(' && ')
    return `(set +x; unset ${this.clearNames.join(' ')} || exit; _cherry_secret_env_status=0; ${reader} || _cherry_secret_env_status=$?; rm -f ${quotedPath} && [ ! -e ${quotedPath} ] && [ "$_cherry_secret_env_status" -eq 0 ] && ${presenceChecks} && unset _cherry_secret_env _cherry_secret_env_status && ${command})`
  }

  /**
   * Returns the complete Windows command block, including fail-closed handlers. The host batch
   * must disable delayed expansion before evaluating any path supplied by the user.
   */
  wrapWindowsCommand(command: string): string[] {
    const missingLabel = '_cherry_secret_env_missing'
    const undeletedLabel = '_cherry_secret_env_undeleted'
    const completeLabel = '_cherry_secret_env_complete'
    const quotedPath = `"${this.path.replace(/%/g, '%%')}"`
    return [
      ':: Load the credentials Cherry Studio wrote for this launch',
      ...this.clearNames.map((name) => `set "${name}="`),
      `for /f "usebackq tokens=1,* delims==" %%a in (${quotedPath}) do set "%%a=%%b"`,
      `del /f /q ${quotedPath}`,
      `if exist ${quotedPath} goto :${undeletedLabel}`,
      ...this.requiredNames.map((name) => `if not defined ${name} goto :${missingLabel}`),
      '',
      ':: Execute command',
      command,
      '',
      `goto :${completeLabel}`,
      '',
      `:${missingLabel}`,
      'echo ERROR: Could not load the credentials Cherry Studio prepared for this launch.',
      `echo Expected file: ${escapeBatchEchoText(this.path)}`,
      'echo Launch again from Cherry Studio.',
      'pause',
      'exit /b 1',
      '',
      `:${undeletedLabel}`,
      'echo ERROR: Could not delete the credential file after loading it, so the CLI was not started.',
      `echo Delete it manually, then launch again from Cherry Studio: ${escapeBatchEchoText(this.path)}`,
      'pause',
      'exit /b 1',
      '',
      `:${completeLabel}`
    ]
  }
}
