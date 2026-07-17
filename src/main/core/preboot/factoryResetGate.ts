import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { CHERRY_HOME } from '@main/core/paths/constants'
import { bootConfigService } from '@main/data/bootConfig'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import { app } from 'electron'

const logger = loggerService.withContext('FactoryResetGate')

/**
 * userData entries that survive the wipe.
 *
 * `logs` — winston opens its file transport at module load (before preboot),
 * so on Windows/Linux (where logs live inside userData) the directory is
 * held open by this very process and deleting it would fail. Logs are
 * diagnostic output, not user data, so keeping them is also the right call
 * on macOS where they live outside userData anyway.
 */
const USER_DATA_KEEP = new Set(['logs'])

/**
 * CHERRY_HOME (~/.cherrystudio) entries that ARE wiped. Everything else in
 * there is a machine artifact, not user data — downloaded tool binaries
 * (`bin/`, `binary-manager/`, `ovms/`, `install/`) survive a factory reset
 * the way an OS survives a phone reset (#17131), and `boot-config.json` is
 * rewritten by the BootConfig reset below rather than deleted here.
 */
const CHERRY_HOME_WIPE = ['config', 'mcp', 'trace']

/**
 * Preboot factory-reset gate (#17131). Consumes the BootConfig
 * `temp.factory_reset` marker written by the `app.factory_reset.request`
 * IpcApi handler: wipes the userData tree and the user-state subtrees of
 * CHERRY_HOME, then resets BootConfig to defaults, so the boot continues
 * into a fresh-install seed.
 *
 * Timing contract: runs at the top of startApp(), before
 * runBackupRestoreGate() (a factory reset supersedes any staged restore —
 * the wipe removes the restore journal and staging tree with the rest of
 * userData). Hard ordering constraints, same as the backup gate: after
 * requireSingleInstance() (destructive fs operations must hold the
 * single-instance lock) and after the path registry is frozen (userData
 * resolution is final).
 *
 * Failure semantics: idempotent retry, no journal. Per-entry delete
 * failures (e.g. a file the OS still holds open) are logged and skipped —
 * a wipe cannot lose data it was asked to destroy, so nothing here may
 * block startup. The marker is cleared only after a full pass, so a crash
 * mid-wipe re-runs the wipe on the next boot. Never throws.
 */
export function runFactoryResetGate(): void {
  try {
    const marker = bootConfigService.get('temp.factory_reset')
    if (marker?.status !== 'pending') return

    // boot-config.json is shared between instances with different userData
    // directories (dev suffix, portable, custom locations). Only the
    // instance that owns the recorded directory may wipe it.
    const userData = app.getPath('userData')
    if (marker.userDataPath !== userData) {
      logger.warn('Factory reset marker belongs to a different userData directory — clearing without wiping', {
        markerPath: marker.userDataPath,
        currentPath: userData
      })
      bootConfigService.set('temp.factory_reset', null)
      bootConfigService.flush()
      return
    }

    logger.info('Factory reset pending — wiping user data', { userData, requestedAt: marker.requestedAt })

    wipeDirectoryEntries(userData, (entry) => !USER_DATA_KEEP.has(entry))
    wipeDirectoryEntries(CHERRY_HOME, (entry) => CHERRY_HOME_WIPE.includes(entry))

    // Reset BootConfig to defaults — which also clears the marker
    // (DefaultBootConfig['temp.factory_reset'] is null). Deliberately keeps
    // `app.user_data_path`: the custom data-directory *location* is machine
    // configuration like the kept binaries above — the reset wipes the data
    // at that location, not the choice of location. Resetting it here would
    // also split this boot (path registry frozen on the old location) from
    // the next one (resolved to the default).
    for (const key of Object.keys(DefaultBootConfig) as BootConfigKey[]) {
      if (key === 'app.user_data_path') continue
      bootConfigService.set(key, DefaultBootConfig[key])
    }
    bootConfigService.flush()

    logger.info('Factory reset completed — continuing boot with a fresh state')
  } catch (error) {
    // A half-wiped state is acceptable for a reset (worst case the DB is
    // gone and the app seeds fresh); refusing to boot over it is not.
    logger.error('Factory reset gate failed — continuing boot', error as Error)
  }
}

/**
 * Best-effort removal of a directory's direct children matching `shouldWipe`.
 * Each entry is deleted independently so one locked file cannot abort the
 * pass — leftovers are logged and abandoned (see the gate's failure
 * semantics above).
 */
function wipeDirectoryEntries(dir: string, shouldWipe: (entry: string) => boolean): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Cannot list directory for factory reset — skipping', { dir, error: String(error) })
    }
    return
  }

  for (const entry of entries) {
    if (!shouldWipe(entry)) continue
    const target = path.join(dir, entry)
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove entry during factory reset — leaving it behind', {
        target,
        error: String(error)
      })
    }
  }
}
