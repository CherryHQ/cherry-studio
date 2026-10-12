import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { getBinaryName } from '@main/utils/binaryResolver'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('DshBunRuntime')

/** Require the bundled runtime, independently of user-installed tools and background extraction. */
export async function resolveDshBunRuntime(): Promise<string> {
  const bundledDir = toAsarUnpackedPath(
    path.join(application.getPath('app.root.resources.binaries'), `${process.platform}-${process.arch}`)
  )
  const executable = path.join(bundledDir, getBinaryName('bun'))
  try {
    const expectedVersion = (await readFile(path.join(bundledDir, '.bun-version'), 'utf8')).trim()
    const { stdout } = await execFileAsync(executable, ['--version'], {
      env: {},
      timeout: 10_000,
      windowsHide: true
    })
    const version = stdout.trim()
    if (!expectedVersion || version !== expectedVersion) {
      throw new Error(`Bundled Bun version mismatch: expected ${expectedVersion || 'a version marker'}, got ${version}`)
    }
  } catch (cause) {
    logger.warn('Bundled Bun runtime is unavailable', { executable, error: cause })
    throw new Error(
      app.isPackaged ? t('agent.session.dsh.bun_unavailable') : t('agent.session.dsh.bun_unavailable_dev'),
      { cause }
    )
  }
  return executable
}
