import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { CHERRY_HOME } from '@main/core/paths/constants'
import { bootConfigService } from '@main/data/bootConfig'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import { app, dialog } from 'electron'

const logger = loggerService.withContext('FactoryResetGate')

/**
 * How many destructive passes a single marker may trigger. Retrying forever
 * would re-wipe data the user created after a pass that looked complete
 * enough to boot on; giving up after the cap and logging loudly is the
 * lesser evil.
 */
const MAX_WIPE_ATTEMPTS = 2

/**
 * userData entries that survive the wipe, in two classes.
 *
 * Process-held diagnostics — not user data, and held open by this very
 * process at gate time:
 *
 * - `logs` — winston opens its file transport at module load (before
 *   preboot), so on Windows/Linux (where logs live inside userData) the
 *   directory cannot be deleted anyway.
 * - `Crashpad` — crashReporter.start() runs in preboot before this gate
 *   (crashTelemetry.ts must arm handlers as early as possible), so the
 *   Crashpad handler already holds its database here.
 *
 * Re-downloadable machine artifacts — the same carve-out as the CHERRY_HOME
 * tool binaries below:
 *
 * - `Runtime` — local model weights (qwen3-embedding ~614MB, pp-ocrv6).
 * - `Toolchain` — the shared onnxruntime binary those models run on
 *   (keeping weights without it would only downgrade `ready` to a re-download).
 *
 * Keeping models against the freshly-reset DB is safe because the embedding
 * registration self-heals: `LocalEmbeddingDownloadService.checkStatus()`
 * re-registers the user_provider/user_model rows before ever reporting
 * `ready`, and the OCR model has no DB registration at all.
 */
const USER_DATA_KEEP = new Set(['logs', 'Crashpad', 'Runtime', 'Toolchain'])

/**
 * CHERRY_HOME (~/.cherrystudio) entries that ARE wiped. Everything else in
 * there is a machine artifact, not user data — downloaded tool binaries
 * (`bin/`, `binary-manager/`, `ovms/`, `install/`) survive a factory reset
 * the way an OS survives a phone reset (#17131), and `boot-config.json` is
 * rewritten by the BootConfig reset below rather than deleted here.
 * The one user-authored file inside the kept `ovms/` tree (the model
 * registry, see OVMS_USER_CONFIG) is removed separately.
 */
const CHERRY_HOME_WIPE = ['config', 'mcp', 'trace']

/**
 * Proof that Cherry Studio actually owns the userData directory: DbService
 * creates this file on the first boot at any location, so a directory the
 * app ever ran from contains it. Directories without it (a mis-pointed
 * custom data path that never hosted the app) must not be tree-wiped.
 */
const OWNERSHIP_SENTINEL = 'cherrystudio.sqlite'

/**
 * Fallback manifest for directories that fail the whole-tree safety check:
 * only Cherry-named artifacts are removed, so a shared or mis-pointed
 * directory loses Cherry's data and nothing else. Chromium state (whose
 * entry names are not Cherry-specific and could belong to another Electron
 * app sharing the directory) is deliberately left behind in this mode —
 * an incomplete reset of a pathological configuration beats deleting
 * someone else's data.
 */
const USER_DATA_MANIFEST = [
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite-shm',
  'Data',
  'cache.json',
  'restore-journal.json',
  'restore-staging'
]

/**
 * Preboot factory-reset gate (#17131). Consumes the BootConfig
 * `temp.factory_reset` marker written by the `app.factory_reset.request`
 * IpcApi handler: wipes the userData tree and the user-state subtrees of
 * CHERRY_HOME, then resets BootConfig to defaults, so the boot continues
 * into a fresh-install seed.
 *
 * Timing contract: runs at the top of startApp() — after
 * requireSingleInstance() (destructive fs operations must hold the
 * single-instance lock) and the frozen path registry, before
 * runBackupRestoreGate() (a factory reset supersedes any staged restore —
 * the wipe removes the restore journal and staging tree with the rest of
 * userData).
 *
 * Failure semantics — bounded retry, no journal:
 * - `attempts` is incremented (best-effort) before each destructive pass;
 *   a marker at MAX_WIPE_ATTEMPTS is abandoned with an error log instead
 *   of wiping again.
 * - Deletion failures on entries outside USER_DATA_KEEP are critical: the
 *   marker is left pending (with its incremented count) so the next boot
 *   retries.
 * - After a clean pass the marker is cleared via a HARD persist. If that
 *   write fails the gate quits the app instead of booting: continuing
 *   would let the user create data that the still-pending marker wipes on
 *   the next start.
 * - A marker recorded for a different userData directory is left untouched
 *   for the owning instance (boot-config.json is shared between dev and
 *   packaged instances).
 * Anything unexpected is logged and boot continues — a half-wiped state is
 * acceptable for a reset; refusing to start over it is not.
 */
export function runFactoryResetGate(): void {
  try {
    const marker = bootConfigService.get('temp.factory_reset')
    if (marker?.status !== 'pending') return

    const userData = app.getPath('userData')
    if (marker.userDataPath !== userData) {
      logger.warn('Factory reset marker belongs to a different userData directory — leaving it for that instance', {
        markerPath: marker.userDataPath,
        currentPath: userData
      })
      return
    }

    const attempts = marker.attempts ?? 0
    if (attempts >= MAX_WIPE_ATTEMPTS) {
      logger.error('Factory reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        attempts
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      return
    }

    logger.info('Factory reset pending — wiping user data', {
      userData,
      requestedAt: marker.requestedAt,
      attempt: attempts + 1
    })

    // Arm the retry accounting BEFORE the destructive pass, so a crash
    // mid-wipe still counts against the cap. Best-effort: if this write
    // fails, the worst case is one extra retry.
    bootConfigService.set('temp.factory_reset', { ...marker, attempts: attempts + 1 })
    bootConfigService.flush()

    const failures: string[] = []
    if (isSafeForWholeTreeWipe(userData)) {
      wipeDirectoryEntries(userData, (entry) => !USER_DATA_KEEP.has(entry), failures)
    } else {
      logger.warn('userData failed the whole-tree safety check — falling back to Cherry-artifact manifest wipe', {
        userData
      })
      wipeDirectoryEntries(userData, (entry) => USER_DATA_MANIFEST.includes(entry), failures)
    }
    wipeDirectoryEntries(CHERRY_HOME, (entry) => CHERRY_HOME_WIPE.includes(entry), failures)
    wipeNonCriticalExtras()

    if (failures.length > 0) {
      logger.error('Factory reset pass had critical failures — marker kept pending for a retry on next boot', {
        failures
      })
      return
    }

    // Reset BootConfig to defaults — which also clears the marker
    // (DefaultBootConfig['temp.factory_reset'] is null). Deliberately keeps
    // `app.user_data_path`: the custom data-directory *location* is machine
    // configuration like the kept binaries above — the reset wipes the data
    // at that location, not the choice of location. Resetting it here would
    // also split this boot (path registry frozen on the old location) from
    // the next one (resolved to the default).
    resetBootConfigToDefaults()
    try {
      bootConfigService.persist()
    } catch (error) {
      // The wipe succeeded but the pending marker could not be durably
      // cleared: booting on would let the user rebuild data that the next
      // start wipes again. Quitting is the only honest option.
      logger.error('Factory reset wiped successfully but the marker could not be cleared — refusing to boot', {
        error: String(error)
      })
      dialog.showErrorBox(
        'Factory Reset Incomplete',
        'Cherry Studio erased its data but could not save the reset completion ' +
          `to ${bootConfigService.getFilePath()}.\n\n` +
          'Starting now would erase anything you create on the next launch, so the app will quit instead.\n\n' +
          'Please check disk space and file permissions, then start Cherry Studio again.'
      )
      app.exit(1)
      return
    }

    logger.info('Factory reset completed — continuing boot with a fresh state')
  } catch (error) {
    logger.error('Factory reset gate failed — continuing boot', error as Error)
  }
}

/**
 * A userData directory qualifies for a wipe-everything-except-keeps pass
 * only when deleting its children cannot plausibly destroy non-Cherry data:
 * not the user's home directory or an ancestor of it, not a filesystem
 * root or other near-root path, and carrying the ownership sentinel that
 * proves the app actually ran here. Everything else gets the
 * USER_DATA_MANIFEST fallback.
 */
function isSafeForWholeTreeWipe(userData: string): boolean {
  const normalized = path.resolve(userData)
  const home = path.resolve(os.homedir())
  if (normalized === home) return false
  if (home.startsWith(normalized + path.sep)) return false
  // Near-root paths (e.g. '/', 'C:\\', '/Users', 'D:\\data') are never
  // tree-wiped even if the app ran there — the blast radius of a mistake
  // is the whole disk. Portable builds with a shallow data dir fall back
  // to the manifest wipe.
  const segments = normalized.split(path.sep).filter(Boolean)
  if (segments.length < 3) return false
  return fs.existsSync(path.join(normalized, OWNERSHIP_SENTINEL))
}

/** Reset every BootConfig key to its default except the data-dir location. */
function resetBootConfigToDefaults(): void {
  for (const key of Object.keys(DefaultBootConfig) as BootConfigKey[]) {
    if (key === 'app.user_data_path') continue
    bootConfigService.set(key, DefaultBootConfig[key])
  }
}

/**
 * Best-effort removal of a directory's direct children matching
 * `shouldWipe`. Each entry is deleted independently; failures are recorded
 * in `failures` (critical — the caller keeps the marker pending) instead
 * of aborting the pass.
 */
function wipeDirectoryEntries(dir: string, shouldWipe: (entry: string) => boolean, failures: string[]): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Cannot list directory for factory reset', { dir, error: String(error) })
      failures.push(dir)
    }
    return
  }

  for (const entry of entries) {
    if (!shouldWipe(entry)) continue
    const target = path.join(dir, entry)
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove entry during factory reset', { target, error: String(error) })
      failures.push(target)
    }
  }
}

/**
 * Cleanup targets whose failure must not block the reset (nothing here
 * holds user data that survives a reboot in a meaningful way):
 *
 * - `app.temp` ({os.tmpdir}/CherryStudio) — the "Clear cache" feature
 *   clears it, and a factory reset must be a superset of Clear cache.
 * - The OVMS model registry (`ovms/ovms/models/config.json`) — the one
 *   user-authored file inside the kept `ovms/` machine-artifact tree;
 *   OvmsManager recreates a default registry when it is absent. Downloaded
 *   model payloads stay (same carve-out as tool binaries), they just lose
 *   their registration.
 */
function wipeNonCriticalExtras(): void {
  const targets = [
    application.getPath('app.temp'),
    path.join(application.getPath('feature.ovms.ovms'), 'models', 'config.json')
  ]
  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove non-critical entry during factory reset', { target, error: String(error) })
    }
  }
}
