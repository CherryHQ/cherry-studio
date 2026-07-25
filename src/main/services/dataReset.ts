import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { SHUTDOWN_TIMEOUT_MS } from '@main/core/lifecycle'
// Preboot dialogs cannot use PreferenceService-backed translations.
import { t } from '@main/i18n'
import { dialog, session } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('DataReset')

/**
 * Stages a reset in the running app and executes it at the next preboot.
 * The marker's location identifies the target profile.
 */

// Bound retries without booting the app writable between attempts.
const MAX_WIPE_ATTEMPTS = 2

/**
 * Exact profile entries removed by a reset. Unlisted entries survive.
 * The marker is removed separately after a durable completion record is written.
 */
export const USER_DATA_WIPE = [
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite-shm',
  'Data',
  'Data.restore',
  'IndexedDB.restore',
  'Local Storage.restore',
  'cache.json',
  'version.log',
  'restore-journal.json',
  'restore-staging',
  '.claude',
  '.copilot_token',
  'config.json',
  'window-state.json',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Cookies',
  'Cookies-journal',
  'Partitions',
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'Service Worker',
  'WebStorage',
  'SharedStorage',
  'Trust Tokens',
  'Trust Tokens-journal',
  'TransportSecurity',
  'Network Persistent State',
  'DIPS'
]

/** Retained diagnostics and downloaded runtimes. */
export const USER_DATA_KEPT = ['logs', 'Crashpad', 'Runtime', 'Toolchain', 'tesseract']

// Absorb transient Windows file locks before consuming a reset attempt.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const

/**
 * Strict on-disk marker schema. `pending` binds authorization to a canonical
 * path; `completed` prevents a resurrected marker from rearming the wipe.
 */
const dataResetMarkerSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('pending'),
    requestedAt: z.string(),
    attempts: z.number().int().nonnegative().optional(),
    canonicalPath: z.string()
  }),
  z.strictObject({
    version: z.literal(1),
    status: z.literal('completed'),
    completedAt: z.string()
  })
])
type DataResetMarker = z.infer<typeof dataResetMarkerSchema>

/** The marker rename landed, but directory durability is unknown. */
class MarkerCommitError extends Error {
  constructor(error: unknown) {
    super(`Data reset marker may have committed: ${String(error)}`)
  }
}

function markerPath(): string {
  return application.getPath('feature.data_reset.marker_file')
}

/**
 * Returns null when absent and quarantines invalid markers.
 * I/O and quarantine failures propagate so boot can fail closed.
 */
function readMarker(): DataResetMarker | null {
  const file = markerPath()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    logger.error('Data reset marker is not valid JSON — renaming aside and ignoring', { error: String(error) })
    renameMarkerAside(file)
    return null
  }

  const result = dataResetMarkerSchema.safeParse(parsed)
  if (!result.success) {
    logger.error('Data reset marker failed schema validation — renaming aside and ignoring', {
      error: result.error.message
    })
    renameMarkerAside(file)
    return null
  }
  return result.data
}

function renameMarkerAside(file: string): void {
  fs.renameSync(file, path.join(path.dirname(file), 'data-reset.pending.invalid'))
  syncParentDirectory(file)
}

/**
 * Atomically writes and syncs the marker. Post-rename failures are reported
 * separately because the marker may already be visible.
 */
function writeMarker(marker: DataResetMarker): void {
  const file = markerPath()
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
  let renamed = false
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, JSON.stringify(marker))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, file)
    renamed = true
    syncParentDirectory(file)
  } catch (error) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // The temp file may not exist.
    }
    if (renamed) throw new MarkerCommitError(error)
    throw error
  }
}

/**
 * Syncs marker directory metadata on POSIX. Node does not support this
 * reliably on Windows.
 */
function syncParentDirectory(file: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(path.dirname(file), 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/** Removes the marker durably. Missing is treated as success. */
function deleteMarker(): void {
  const file = markerPath()
  try {
    fs.unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  syncParentDirectory(file)
}

/**
 * Confirms in the main process, stages the marker, clears live Chromium
 * state, and gracefully relaunches.
 */
export async function requestDataReset(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: t('dialog.data_reset.title'),
    message: t('dialog.data_reset.message'),
    buttons: [t('dialog.data_reset.cancel'), t('dialog.data_reset.confirm')],
    defaultId: 0,
    cancelId: 0
  })
  if (response !== 1) return

  const userDataPath = application.getPath('app.userdata')
  // Bind authorization to the physical directory the user confirmed.
  try {
    writeMarker({
      version: 1,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      canonicalPath: canonicalize(userDataPath)
    })
  } catch (error) {
    if (!(error instanceof MarkerCommitError)) throw error
    // The marker may be committed, so continue shutting down safely.
    logger.error('Data reset marker committed without durable directory metadata — relaunching safely', {
      error: String(error)
    })
  }

  // Clear live session state before the filesystem pass.
  await clearChromiumState()

  // Give services time to release files before the next boot wipes them.
  const timer = setTimeout(() => {
    logger.warn('Shutdown timed out before relaunch — relaunching anyway')
    application.relaunch()
  }, SHUTDOWN_TIMEOUT_MS)
  try {
    await application.shutdown()
  } catch (error) {
    logger.error('Error during shutdown before relaunch:', error as Error)
  } finally {
    clearTimeout(timer)
    application.relaunch()
  }
}

/**
 * Executes a pending reset before services open profile data.
 * The target path and attempt count are committed before deletion. Success
 * commits `completed` before removing the marker; unsafe failures quit.
 */
export function runDataReset(): void {
  try {
    const marker = readMarker()
    if (!marker) return

    // A completed marker never authorizes another wipe.
    if (marker.status === 'completed') {
      logger.info('Found a completed data reset marker — clearing it and booting normally', {
        completedAt: marker.completedAt
      })
      // Re-commit in case the previous directory sync failed.
      writeMarker(marker)
      try {
        deleteMarker()
      } catch (error) {
        logger.warn('Could not remove a completed data reset marker — leaving it for a later boot', {
          error: String(error)
        })
      }
      return
    }

    const userData = application.getPath('app.userdata')

    // Refuse redirected or relocated targets.
    const actualCanonical = canonicalize(userData)
    if (marker.canonicalPath !== actualCanonical) {
      logger.error('Data reset refused: userData resolves to a different physical directory than recorded', {
        recorded: marker.canonicalPath,
        actual: actualCanonical
      })
      refuseResetForPathMismatch()
      return
    }

    const attempts = marker.attempts ?? 0
    if (attempts >= MAX_WIPE_ATTEMPTS) {
      logger.error('Data reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        attempts
      })
      abandonIncompleteReset()
      return
    }

    logger.info('Data reset pending — wiping user data', {
      userData,
      requestedAt: marker.requestedAt,
      attempt: attempts + 1
    })

    // Record the attempt before deleting anything.
    try {
      writeMarker({ ...marker, attempts: attempts + 1, canonicalPath: actualCanonical })
    } catch (error) {
      logger.error('Data reset halted: the attempt count could not be durably recorded — refusing to boot', {
        error: String(error)
      })
      showDataResetError(
        'Data Reset Failed',
        'Cherry Studio could not record the data reset state ' +
          `in ${markerPath()}.\n\n` +
          'Starting now could erase data you create later, so the app will quit instead.\n\n' +
          'Please check disk space and file permissions, then start Cherry Studio again.'
      )
      return
    }

    const failures: string[] = []
    wipeDirectoryEntries(userData, shouldWipe, failures)
    // Temporary cache removal is best-effort.
    try {
      fs.rmSync(application.getPath('app.temp'), RM_OPTIONS)
    } catch (error) {
      logger.warn('Failed to remove the app temp dir during data reset', { error: String(error) })
    }

    if (failures.length > 0) {
      if (attempts + 1 < MAX_WIPE_ATTEMPTS) {
        logger.error('Data reset pass had critical failures — relaunching to retry in preboot', { failures })
        application.relaunch()
        return
      }
      // Disarm the marker before booting with partial data.
      logger.error('Data reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        failures
      })
      abandonIncompleteReset()
      return
    }

    // Commit terminal state before removing the marker.
    try {
      writeMarker({ version: 1, status: 'completed', completedAt: new Date().toISOString() })
    } catch (error) {
      logger.error(
        'Data reset wiped successfully but the completion record could not be committed — refusing to boot',
        {
          error: String(error)
        }
      )
      showDataResetError(
        'Data Reset Incomplete',
        'Cherry Studio erased its data but could not record the reset as finished ' +
          `in ${markerPath()}.\n\n` +
          'Starting now could erase anything you create on the next launch, so the app will quit instead.\n\n' +
          'Please check disk space and file permissions, then start Cherry Studio again.'
      )
      return
    }

    try {
      deleteMarker()
    } catch (error) {
      logger.warn('Could not remove the completed data reset marker — the next boot will clear it', {
        error: String(error)
      })
    }

    logger.info('Data reset completed — relaunching into a fresh state')
    application.relaunch()
  } catch (error) {
    logger.error('Data reset failed — refusing to boot', error as Error)
    showDataResetError(
      'Data Reset Failed',
      'Cherry Studio could not safely complete a pending data reset. ' +
        'The app will quit instead of starting with a reset marker still present.\n\n' +
        'Please check disk space and file permissions, then start Cherry Studio again.'
    )
  }
}

function refuseResetForPathMismatch(): void {
  deleteMarker()
  showPathMismatchWarning()
}

function abandonIncompleteReset(): void {
  deleteMarker()
  showIncompleteResetWarning()
}

function showDataResetError(title: string, message: string): void {
  dialog.showErrorBox(title, message)
  application.forceExit(1)
}

function shouldWipe(entry: string): boolean {
  return USER_DATA_WIPE.includes(entry)
}

/** Clears known sessions with a timeout so shutdown cannot hang. */
async function clearChromiumState(): Promise<void> {
  const clearOperation = async (sessionName: string, stateName: string, operation: () => Promise<void>) => {
    try {
      await operation()
    } catch (error) {
      logger.warn(`Failed to clear ${stateName} for the ${sessionName} session during data reset request`, {
        error: String(error)
      })
    }
  }
  const clearSession = (name: string, target: Electron.Session) =>
    Promise.all([
      clearOperation(name, 'data', () => target.clearData()),
      clearOperation(name, 'authentication cache', () => target.clearAuthCache())
    ])

  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.all([
        clearSession('default', session.defaultSession),
        clearSession('persist:webview', session.fromPartition('persist:webview'))
      ]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          logger.warn('Chromium state clear timed out during data reset request — continuing with shutdown')
          resolve()
        }, SHUTDOWN_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** Resolves the physical target used to authorize the wipe. */
function canonicalize(p: string): string {
  return fs.realpathSync.native(path.resolve(p))
}

function showPathMismatchWarning(): void {
  dialog.showErrorBox(
    'Data Reset Cancelled',
    'Cherry Studio did not run Data Reset because the data location changed after confirmation.\n\n' +
      'No data was removed, and the pending request has been cleared. ' +
      'Run Data Reset again from Settings if you still want to erase this profile.'
  )
}

function showIncompleteResetWarning(): void {
  dialog.showErrorBox(
    'Data Reset Incomplete',
    'Cherry Studio could not remove some of its data during the data reset.\n\n' +
      'The app will start with whatever remains. ' +
      'Please check file permissions (or antivirus locks) and run Data Reset again from Settings.'
  )
}

/** Removes matching children independently and records failures. */
function wipeDirectoryEntries(dir: string, shouldWipeEntry: (entry: string) => boolean, failures: string[]): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Cannot list directory for data reset', { dir, error: String(error) })
      failures.push(dir)
    }
    return
  }

  for (const entry of entries) {
    if (!shouldWipeEntry(entry)) continue
    try {
      fs.rmSync(path.join(dir, entry), RM_OPTIONS)
    } catch (error) {
      logger.warn('Failed to remove entry during data reset', { entry, error: String(error) })
      failures.push(path.join(dir, entry))
    }
  }
}
