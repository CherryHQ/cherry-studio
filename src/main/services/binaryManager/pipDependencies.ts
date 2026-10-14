import fs from 'fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { sanitizedCommandError } from './commandError'
import { runUv } from './pythonRuntime'

/** uv nests pipx environments one level below the install; pyvenv.cfg identifies them on every platform. */
export async function findToolEnvironment(installPath: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fsp.readdir(installPath)
  } catch {
    return null
  }
  for (const entry of entries) {
    const environment = path.join(installPath, entry)
    try {
      await fsp.access(path.join(environment, 'pyvenv.cfg'), fs.constants.F_OK)
      return environment
    } catch {
      continue
    }
  }
  return null
}

export async function installToolDependencies(options: {
  installPath: string
  dependencies: readonly string[]
  env: Record<string, string>
}): Promise<void> {
  const environment = await findToolEnvironment(options.installPath)
  if (!environment) throw new Error(`No Python tool environment found in ${options.installPath}`)

  try {
    // uv audits satisfied requirements without changes, and repairs older environments with this same call.
    await runUv(
      ['pip', 'install', '--python', environment, ...options.dependencies],
      { ...options.env, UV_PYTHON_DOWNLOADS: 'never', UV_HTTP_TIMEOUT: '30', UV_HTTP_RETRIES: '2' },
      120_000
    )
  } catch (error) {
    throw new Error(`Failed to update Python tool environment ${environment}: ${sanitizedCommandError(error)}`)
  }
}
