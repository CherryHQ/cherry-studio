import fs from 'fs'
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { valid as semverValid } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { regionService } from '@main/services/RegionService'
import { isPathWithin } from '@main/utils/binaryEnv'
import { getBinaryName } from '@main/utils/binaryResolver'

import { sanitizedCommandError } from './commandError'

/**
 * Cherry-owned CPython for the tools that need one (mise's pipx backend runs
 * them through uv, which takes the interpreter from `UV_PYTHON`).
 *
 * mise can install Python itself, but only from GitHub releases — unreachable
 * from mainland China. The bundled uv can be pointed at a mirror instead, so
 * provisioning lives here and mise is never told about Python at all.
 */

const logger = loggerService.withContext('pythonRuntime')

const DEFAULT_VERSION = '3.12.13'
const MIRROR_TIMEOUT_MS = 5 * 60_000
const OFFICIAL_TIMEOUT_MS = 10 * 60_000
const FIND_TIMEOUT_MS = 120_000
// uv appends `/{build-tag}/{archive}` and verifies the result against its
// built-in catalog's checksums, so any host mirroring that layout is safe.
const CHINA_PYTHON_MIRROR = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

const execFileAsync = promisify(execFile)

function installDir(): string {
  return application.getPath('feature.binary.data.uv_python')
}

async function runUv(args: string[], env: Record<string, string>, timeoutMs: number): Promise<string> {
  const uvBin = application.getPath('cherry.bin', getBinaryName('uv'))
  if (!fs.existsSync(uvBin)) throw new Error('Bundled uv is not available')
  const cwd = application.getPath('app.temp')
  const { stdout } = await execFileAsync(uvBin, args, { cwd, env, timeout: timeoutMs })
  return stdout
}

/**
 * The interpreter uv lists for `version` in Cherry storage, including a failed
 * `--version` check so the caller can repair it and preserve the cause.
 */
async function findInstalled(
  version: string,
  env: Record<string, string>
): Promise<{ kind: 'found'; path: string; error?: string } | { kind: 'missing'; error: string } | null> {
  let pythonPath: string | undefined
  try {
    const stdout = await runUv(
      ['python', 'find', version, '--managed-python', '--no-python-downloads', '--no-project', '--resolve-links'],
      env,
      FIND_TIMEOUT_MS
    )
    pythonPath = stdout.trim().split(/\r?\n/)[0]
  } catch (error) {
    const message = sanitizedCommandError(error)
    if (
      message.includes('No interpreter found for Python') ||
      message.includes('Failed to inspect Python interpreter from managed installations')
    ) {
      return { kind: 'missing', error: message }
    }
    throw new Error(`Failed to find managed Python ${version}: ${message}`)
  }
  if (!pythonPath) throw new Error(`uv python find returned no path for Python ${version}`)
  // Never adopt a system interpreter: only Cherry's own install dir counts.
  if (!path.isAbsolute(pythonPath) || !isPathWithin(env.UV_PYTHON_INSTALL_DIR, pythonPath)) return null
  try {
    await execFileAsync(pythonPath, ['--version'], {
      cwd: application.getPath('app.temp'),
      env,
      timeout: FIND_TIMEOUT_MS
    })
  } catch (error) {
    const message = sanitizedCommandError(error)
    logger.warn('Cherry-managed Python runtime is not runnable', {
      path: pythonPath,
      error: message
    })
    return { kind: 'found', path: pythonPath, error: message }
  }
  return { kind: 'found', path: pythonPath }
}

/**
 * Absolute path to a Cherry-managed interpreter for `requestedVersion` (a bare
 * version such as `3.12`, not a mise spec), installing one if needed. In China
 * the npmmirror mirror is tried first, then the official source.
 *
 * @param baseEnv the isolated environment the uv subprocess should inherit
 * @throws if every source fails, carrying each source's error
 */
export async function provideManagedPython(requestedVersion: string, baseEnv: Record<string, string>): Promise<string> {
  const version = semverValid(requestedVersion) ?? (requestedVersion === '3.12' ? DEFAULT_VERSION : requestedVersion)
  const dir = installDir()
  const env = {
    ...baseEnv,
    UV_PYTHON_INSTALL_DIR: dir,
    UV_HTTP_TIMEOUT: '30',
    UV_HTTP_RETRIES: '2'
  }

  const existing = await findInstalled(version, env)
  if (existing?.kind === 'found' && existing.error === undefined) return existing.path

  await fsp.mkdir(dir, { recursive: true })
  const installArgs = [
    'python',
    'install',
    version,
    // Unconditional: a plain install exits successfully without doing anything
    // whenever uv still lists the version, and a broken one is listed just the same.
    '--reinstall',
    '--install-dir',
    dir,
    '--no-bin',
    '--managed-python',
    '--no-config'
  ]
  const inChina = await regionService.detectIsInChina()
  const failures: string[] = []

  if (inChina) {
    try {
      await runUv(installArgs, { ...env, UV_PYTHON_INSTALL_MIRROR: CHINA_PYTHON_MIRROR }, MIRROR_TIMEOUT_MS)
    } catch (error) {
      failures.push(`npmmirror: ${sanitizedCommandError(error)}`)
    }
  }

  if (!inChina || failures.length > 0) {
    try {
      await runUv(installArgs, env, OFFICIAL_TIMEOUT_MS)
    } catch (error) {
      failures.push(`official: ${sanitizedCommandError(error)}`)
      throw new Error(`Failed to install Python ${version}\n${failures.join('\n')}`)
    }
  }

  const installed = await findInstalled(version, env)
  if (installed?.kind === 'missing') {
    throw new Error(`Managed Python in ${dir} is not runnable after install: ${installed.error}`)
  }
  if (installed?.kind === 'found' && installed.error !== undefined) {
    throw new Error(`Managed Python at ${installed.path} is not runnable after install: ${installed.error}`)
  }
  if (!installed) throw new Error(`Managed Python is not runnable after install: ${version}`)
  return installed.path
}
