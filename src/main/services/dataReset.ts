import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { bootConfigService } from '@main/data/bootConfig'
// Request side only: t resolves the language through PreferenceService,
// which exists in the live app but NOT at preboot — the execution side's
// dialogs below are deliberately hardcoded en-US instead.
import { t } from '@main/i18n'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import { app, dialog, session } from 'electron'

const logger = loggerService.withContext('DataReset')

/**
 * Data Reset (#17131): erase Cherry's user data and boot a fresh-install
 * state. One capability, two faces sharing this module:
 *
 * - {@link requestDataReset} — the running app confirms the request, stages
 *   the BootConfig `temp.data_reset` marker, clears live Chromium storage,
 *   and relaunches through a graceful shutdown.
 * - {@link runDataReset} — the next process consumes the marker at preboot
 *   timing (called from main.ts before any other gate reads user data),
 *   because a running process cannot delete files it still holds open.
 *
 * Preboot is only the *caller* of the execution face; the capability is a
 * removable application feature and lives here in services/ (see
 * core/preboot/README.md membership criteria).
 */

/**
 * How many destructive passes a single marker may trigger. A failed pass
 * relaunches straight back into preboot (no writable app in between — see
 * the failure branch in runDataReset), so the cap's job is to bound that
 * relaunch loop when a failure is persistent rather than transient.
 */
const MAX_WIPE_ATTEMPTS = 2

/**
 * The one wipe list: userData entries deleted by a data reset, all
 * belonging to Cherry (or to Chromium state Cherry's session produced).
 * Everything not named here survives — user files in an adopted directory,
 * old-build debris of unknown provenance, and the kept machine artifacts
 * below. There is no whole-tree mode and no ownership inference: deleting
 * only explicitly-named entries is what makes the reset safe in any
 * directory a marker can legitimately point at (#17138 review).
 *
 * Cherry user state:
 * - `cherrystudio.sqlite` (+ `-wal`/`-shm`) — the app database and its WAL
 *   sidecars. Exact names, NOT a `cherrystudio.sqlite` prefix: a prefix match
 *   would also delete a user's own `cherrystudio.sqlite-personal-backup` in an
 *   adopted directory, and the engine leaves no other sqlite siblings — the
 *   -wal/-shm pair is all DbService/MigrationDbService ever recognise
 *   (#17138 review).
 * - `Data` — all business files (Files/Notes/KnowledgeBase/Workspace/…).
 * - `Data.restore` / `IndexedDB.restore` / `Local Storage.restore` —
 *   staging sidecars written by LegacyBackupManager's v1 restore path
 *   (inert since its startup consumer was removed; historical installs
 *   may still carry them, holding full copies of user data).
 * - `cache.json` — main-process persist cache.
 * - `version.log` — LIVE v2 state (VersionService writes it every boot), and
 *   the first criterion of MigrationPaths.hasV1Data(): leaving it behind
 *   after the sqlite wipe would make the next boot re-detect "v1 data" and
 *   run a spurious migration even with zero v1 residue.
 * - `restore-journal.json` / `restore-staging` — backup-restore gate state.
 * - `.claude` — agents' Claude Code config (credentials/sessions).
 * - `.copilot_token` — legacy Copilot credential at the userData root.
 *
 * v1 residue (feeds hasV1Data — see version.log above):
 * - `config.json` — v1 electron-store.
 * - `window-state.json` — v1 electron-window-state.
 *
 * Chromium state — the deterministic layer under the request side's
 * best-effort `clearStorageData()` (which clears content but not the
 * directories, and cannot beat Chromium's exit-time flush). Only the
 * high-value entries observed in real installs are listed; whatever a
 * future Chromium adds is covered semantically by the API layer and
 * documented as residue otherwise:
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

/**
 * userData entries deliberately KEPT, documented here (and pinned by the
 * paths test) rather than consulted at runtime — a whitelist wipe keeps
 * everything it does not name:
 * - `logs`, `Crashpad` — process-held diagnostics, not user data.
 * - `Runtime`, `Toolchain`, `tesseract` — re-downloadable machine artifacts
 *   (model weights, onnxruntime, OCR traineddata); they survive a reset the
 *   way an OS survives a phone reset (#17131, #16838).
 */
export const USER_DATA_KEPT = ['logs', 'Crashpad', 'Runtime', 'Toolchain', 'tesseract']

/**
 * On Windows, Node retries EBUSY/EPERM/ENOTEMPTY deletions when maxRetries is
 * set — absorbing the transient locks an antivirus or the search indexer puts
 * on files it is scanning (opened without FILE_SHARE_DELETE), so a scan
 * doesn't consume one of the marker's MAX_WIPE_ATTEMPTS. Worst case this
 * blocks preboot for a few hundred extra milliseconds per stuck entry.
 */
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const

/**
 * Request face: stage a data reset and relaunch; {@link runDataReset} wipes
 * on the next boot. Called by the `app.data_reset.request` IpcApi handler.
 *
 * The final confirmation lives HERE, in a native dialog, not in the
 * renderer: the request arms a whole-profile wipe, and a compromised or
 * buggy renderer must not be able to arm it with a single unconfirmed IPC
 * call. Declining resolves without staging anything — a silent no-op, since
 * the user just cancelled.
 *
 * The marker is staged with persist() (not flush) so a failed write rejects
 * the request instead of relaunching without a staged marker.
 */
export async function requestDataReset(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: t('dialog.data_reset.title'),
    message: t('dialog.data_reset.message'),
    detail: t('dialog.data_reset.detail'),
    buttons: [t('dialog.data_reset.cancel'), t('dialog.data_reset.confirm')],
    defaultId: 0,
    cancelId: 0
  })
  if (response !== 1) return

  const userDataPath = application.getPath('app.userdata')
  const previous = bootConfigService.get('temp.data_reset')
  bootConfigService.set('temp.data_reset', {
    status: 'pending',
    userDataPath,
    // Pin the physical directory the user confirmed: the wipe refuses a
    // pass whose realpath resolution has changed since this moment.
    canonicalPath: canonicalize(userDataPath),
    requestedAt: new Date().toISOString()
  })
  try {
    bootConfigService.persist()
  } catch (error) {
    // Roll back the in-memory marker (same pattern as userDataRelocation):
    // persist() keeps the dirty flag on failure, so a later flush — e.g.
    // during shutdown — would otherwise stage the wipe the user was just
    // told had failed.
    bootConfigService.set('temp.data_reset', previous)
    throw error
  }

  // Semantic Chromium clear while the sessions are alive — the layer the
  // preboot pass cannot provide (it can only rm the storage directories it
  // knows by name; this API call covers whatever the running Chromium
  // actually persisted). Best-effort by design: the marker is already
  // durable, and runDataReset's rm pass is the deterministic layer.
  await clearChromiumState()

  // Graceful relaunch, not application.relaunch(): running services (OVMS
  // and friends) must release their child processes and file handles
  // before the next boot's wipe deletes the files they may hold open.
  await application.relaunchAfterShutdown()
}

/**
 * Execution face (#17131). Consumes the BootConfig `temp.data_reset` marker
 * written by {@link requestDataReset}: deletes the {@link USER_DATA_WIPE}
 * entries from userData, resets BootConfig to defaults, then relaunches so
 * the app boots a fresh-install state in a clean process.
 *
 * Scope: userData only. `~/.cherrystudio` is machine domain (tool binaries,
 * models, OVMS registry, config/mcp/trace) and is deliberately untouched
 * (#17138 maintainer decision); the retained credentials there are
 * documented in the breaking-changes entry.
 *
 * Timing contract: runs at the top of startApp() — after
 * requireSingleInstance() (destructive fs operations must hold the
 * single-instance lock) and the frozen path registry, before
 * runBackupRestoreGate() (a data reset supersedes any staged restore —
 * the wipe removes the restore journal and staging tree).
 *
 * Failure semantics — bounded retry, no journal:
 * - `attempts` is durably incremented (hard persist) before each destructive
 *   pass. If that write fails runDataReset QUITS: a pending marker must never
 *   coexist with a writable app, or data the user creates would be deleted
 *   by a later pass (#17138 review).
 * - The physical identity of the target is pinned in the marker
 *   (`canonicalPath`, realpath-resolved) by the same durable write; a pass
 *   whose re-resolution disagrees refuses to wipe — a replaced
 *   symlink/junction must not redirect a recorded authorization onto a new
 *   directory (#17138 review).
 * - Deletion failures are critical. With attempts left, the pass relaunches
 *   straight back into preboot to retry. At the cap it gives up: marker
 *   cleared, failure surfaced in a dialog, boot continues over whatever
 *   remains.
 * - After a clean pass the marker is cleared via a HARD persist (quit on
 *   failure — see above), then it relaunches: the reset session must
 *   not keep running in the process that wiped it (stale Chromium flags,
 *   cached ensured paths); the next boot starts fresh with no marker.
 * - A marker recorded for a different userData directory is left untouched
 *   for the owning instance (boot-config.json is shared between dev and
 *   packaged instances).
 * Anything unexpected is logged and boot continues — a half-wiped state is
 * acceptable for a reset; refusing to start over it is not.
 */
export function runDataReset(): void {
  try {
    const marker = bootConfigService.get('temp.data_reset')
    if (marker?.status !== 'pending') return

    // Same source as the write side (requestDataReset) — the marker path
    // check below is a strict string comparison, so both sides must read
    // the registry, not raw Electron.
    const userData = application.getPath('app.userdata')
    if (marker.userDataPath !== userData) {
      logger.warn('Data reset marker belongs to a different userData directory — leaving it for that instance', {
        markerPath: marker.userDataPath,
        currentPath: userData
      })
      return
    }

    // Physical identity check: the wipe follows the path the filesystem
    // resolves, so authorization must be bound to that resolution, not to
    // the string. A mismatch means a symlink/junction/mount changed between
    // the request (or a previous pass) and now — refuse and clear.
    const actualCanonical = canonicalize(userData)
    if (marker.canonicalPath !== undefined && marker.canonicalPath !== actualCanonical) {
      logger.error('Data reset refused: userData resolves to a different physical directory than recorded', {
        recorded: marker.canonicalPath,
        actual: actualCanonical
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      showIncompleteResetWarning()
      return
    }

    // boot-config.json is hand-editable and `attempts` feeds arithmetic, so a
    // corrupted value (say "x") would disable the cap entirely — coerce
    // instead of trusting the shape.
    const attempts = Number(marker.attempts) || 0
    if (attempts >= MAX_WIPE_ATTEMPTS) {
      logger.error('Data reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        attempts
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      showIncompleteResetWarning()
      return
    }

    logger.info('Data reset pending — wiping user data', {
      userData,
      requestedAt: marker.requestedAt,
      attempt: attempts + 1
    })

    // Arm the retry accounting BEFORE the destructive pass, so a crash
    // mid-wipe still counts against the cap. Must be a durable persist(), not
    // flush(): an increment that never reaches disk voids the cap. If the
    // count cannot be recorded, QUIT — booting on would leave a pending
    // marker coexisting with a writable app, and a later pass would delete
    // whatever the user created in between (#17138 review). The canonical
    // identity rides the same durable write.
    try {
      bootConfigService.set('temp.data_reset', { ...marker, attempts: attempts + 1, canonicalPath: actualCanonical })
      bootConfigService.persist()
    } catch (error) {
      logger.error('Data reset halted: the attempt count could not be durably recorded — refusing to boot', {
        error: String(error)
      })
      dialog.showErrorBox(
        'Data Reset Failed',
        'Cherry Studio could not record the data reset state ' +
          `in ${bootConfigService.getFilePath()}.\n\n` +
          'Starting now could erase data you create later, so the app will quit instead.\n\n' +
          'Please check disk space and file permissions, then start Cherry Studio again.'
      )
      app.exit(1)
      return
    }

    const failures: string[] = []
    wipeDirectoryEntries(userData, shouldWipe, failures)
    // Best-effort: `app.temp` ({os.tmpdir}/CherryStudio) holds no data that
    // matters across reboots; the "Clear cache" feature clears it, and a
    // data reset must be a superset of Clear cache. No recreate needed —
    // the relaunch below hands path ensuring to the fresh process.
    try {
      fs.rmSync(application.getPath('app.temp'), RM_OPTIONS)
    } catch (error) {
      logger.warn('Failed to remove the app temp dir during data reset', { error: String(error) })
    }

    if (failures.length > 0) {
      // Never boot into a writable state on a pending marker: data the user
      // creates in a half-wiped app would be deleted by the retry pass on
      // the next start (#17138 review).
      if (attempts + 1 < MAX_WIPE_ATTEMPTS) {
        logger.error('Data reset pass had critical failures — relaunching to retry in preboot', { failures })
        // app.relaunch + app.exit (not application.*): no before-quit
        // handlers may write files after the wipe.
        app.relaunch()
        app.exit(1)
        return
      }
      // Out of attempts: give up NOW instead of leaving the marker pending.
      // The clear rides flush() — a lost write is re-cleared by the cap
      // path on the next boot without another destructive pass.
      logger.error('Data reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        failures
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      showIncompleteResetWarning()
      return
    }

    // Reset BootConfig to defaults — which also clears the marker
    // (DefaultBootConfig['temp.data_reset'] is null). Deliberately keeps
    // `app.user_data_path`: the custom data-directory *location* is machine
    // configuration — the reset wipes the data at that location, not the
    // choice of location.
    resetBootConfigToDefaults()
    try {
      bootConfigService.persist()
    } catch (error) {
      // The wipe succeeded but the pending marker could not be durably
      // cleared: booting on would let the user rebuild data that the next
      // start wipes again. Quitting is the only honest option.
      logger.error('Data reset wiped successfully but the marker could not be cleared — refusing to boot', {
        error: String(error)
      })
      dialog.showErrorBox(
        'Data Reset Incomplete',
        'Cherry Studio erased its data but could not save the reset completion ' +
          `to ${bootConfigService.getFilePath()}.\n\n` +
          'Starting now would erase anything you create on the next launch, so the app will quit instead.\n\n' +
          'Please check disk space and file permissions, then start Cherry Studio again.'
      )
      // Deliberately app.exit(), not application.quit(): non-zero exit code,
      // and no before-quit handlers — nothing may write files after the wipe.
      app.exit(1)
      return
    }

    // Relaunch instead of continuing: the marker is durably cleared, so the
    // next boot is a normal fresh-install boot — in a clean process whose
    // module-top-level Chromium flags read the post-reset BootConfig values
    // (#17138 suggestion). No loop: no marker, no action on the next pass.
    logger.info('Data reset completed — relaunching into a fresh state')
    app.relaunch()
    app.exit(0)
  } catch (error) {
    logger.error('Data reset failed — continuing boot', error as Error)
  }
}

/** Whitelist membership: exact names only. */
function shouldWipe(entry: string): boolean {
  return USER_DATA_WIPE.includes(entry)
}

/**
 * Clear every storage kind of the sessions Cherry uses (the same pair the
 * "Clear cache" feature targets: default + the miniapp webview partition).
 * No `storages` filter — a data reset clears everything the API knows,
 * including kinds a future Chromium adds.
 */
async function clearChromiumState(): Promise<void> {
  const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
  for (const s of sessions) {
    try {
      await s.clearCache()
      await s.clearStorageData()
      await s.clearAuthCache()
    } catch (error) {
      logger.warn('Failed to clear a session during data reset request', { error: String(error) })
    }
  }
}

/**
 * Filesystem identity for the marker binding: resolve symlinks and junctions
 * so the wipe authorization sticks to the physical directory the request
 * targeted. `.native` also restores the on-disk casing on Windows. A path
 * realpath cannot resolve either does not exist or is unreadable — lexical
 * resolve is enough there (the wipe itself then fails loudly).
 */
function canonicalize(p: string): string {
  const resolved = path.resolve(p)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

/**
 * Tell the user the reset gave up with data left behind. Shown
 * synchronously before any window exists — Electron supports showErrorBox
 * pre-ready. Hardcoded en-US like the other execution-side dialogs: the
 * i18n resolver needs PreferenceService for the language, which does not
 * exist at preboot (and whose store is exactly what the wipe deletes).
 */
function showIncompleteResetWarning(): void {
  dialog.showErrorBox(
    'Data Reset Incomplete',
    'Cherry Studio could not remove some of its data during the data reset.\n\n' +
      'The app will start with whatever remains. ' +
      'Please check file permissions (or antivirus locks) and run Data Reset again from Settings.'
  )
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
