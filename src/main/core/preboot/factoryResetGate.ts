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
 * How many destructive passes a single marker may trigger. A failed pass
 * relaunches straight back into preboot (no writable app in between — see
 * the failure branch in the gate), so the cap's job is to bound that
 * relaunch loop when a failure is persistent rather than transient.
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
export const USER_DATA_KEEP = new Set(['logs', 'Crashpad', 'Runtime', 'Toolchain'])

/**
 * CHERRY_HOME (~/.cherrystudio) entries that ARE wiped. Everything else in
 * there is a machine artifact, not user data — downloaded tool binaries
 * (`bin/`, `binary-manager/`, `ovms/`, `install/`) survive a factory reset
 * the way an OS survives a phone reset (#17131), and `boot-config.json` is
 * rewritten by the BootConfig reset below rather than deleted here.
 * The one user-authored file inside the kept `ovms/` tree (the model
 * registry, 'feature.ovms.model_registry_file') is removed separately in
 * the gate's wipe pass — as a critical target, so a failed removal keeps
 * the marker pending like any other user-state entry.
 */
export const CHERRY_HOME_WIPE = ['config', 'mcp', 'trace']

/**
 * Proof that Cherry Studio actually owns the userData directory: DbService
 * creates this file on the first boot at any location, so a directory the
 * app ever ran from contains it. Directories without it (a mis-pointed
 * custom data path that never hosted the app) must not be tree-wiped.
 */
export const OWNERSHIP_SENTINEL = 'cherrystudio.sqlite'

/**
 * On Windows, Node retries EBUSY/EPERM/ENOTEMPTY deletions when maxRetries is
 * set — absorbing the transient locks an antivirus or the search indexer puts
 * on files it is scanning (opened without FILE_SHARE_DELETE), so a scan
 * doesn't consume one of the marker's MAX_WIPE_ATTEMPTS. Worst case this
 * blocks preboot for a few hundred extra milliseconds per stuck entry.
 */
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const

/**
 * How much of userData a destructive pass may remove. Decided once per
 * marker by {@link decideWipeMode} and recorded in it — see there for why
 * re-deriving on retries is wrong.
 */
type WipeMode = 'tree' | 'owned-manifest' | 'manifest'

const WIPE_MODES: readonly string[] = ['tree', 'owned-manifest', 'manifest'] satisfies readonly WipeMode[]

/**
 * Strict fallback manifest ('manifest' mode) for directories that fail the
 * whole-tree safety check AND lack the ownership sentinel: only
 * Cherry-named artifacts are removed, so a mis-pointed directory that never
 * hosted the app loses Cherry's data and nothing else. Chromium state
 * (whose entry names are not Cherry-specific and could belong to another
 * Electron app sharing the directory) is deliberately left behind — an
 * incomplete reset of a pathological configuration beats deleting someone
 * else's data. No sentinel also means no database, hence no v1
 * migration-status row to lose: the v1-remigration hazard the owned
 * manifest exists for cannot arise here.
 */
export const USER_DATA_MANIFEST = [
  'cherrystudio.sqlite',
  'cherrystudio.sqlite-wal',
  'cherrystudio.sqlite-shm',
  'Data',
  'cache.json',
  'restore-journal.json',
  'restore-staging'
]

/**
 * Extra entries wiped in 'owned-manifest' mode — the sentinel proves the
 * directory hosted Cherry, but its shape (near-root, or ~/.cherrystudio
 * itself) makes a whole-tree pass too risky. Proven ownership is what makes
 * these non-Cherry-specific names safe to delete:
 *
 * - v1 artifacts `version.log`, `IndexedDB`, `Local Storage`, `config.json`:
 *   the wipe deletes the migration-status row with the database, so leaving
 *   these behind would make the next boot re-detect v1 data
 *   (MigrationPaths.hasV1Data) and migrate the residue back into the freshly
 *   reset app. `Local Storage` also hosts the v2 renderer persist cache.
 * - `.claude` ('feature.agents.claude.root', Claude Code config/credentials)
 *   and `tesseract` ('feature.ocr.tesseract'): user state at the userData
 *   root that the Cherry-named manifest misses.
 *
 * Residual: the rest of Chromium's state (Cookies, Network, Partitions, …)
 * still survives in this mode — enumerating Chromium's directory zoo is a
 * losing game, and the common case is handled by 'tree' mode.
 */
export const OWNED_MANIFEST_EXTRAS = [
  'version.log',
  'IndexedDB',
  'Local Storage',
  'config.json',
  '.claude',
  'tesseract'
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
 * - `attempts` is durably incremented (hard persist) before each destructive
 *   pass — a pass never runs on unrecorded accounting, or the cap would be
 *   void whenever boot-config is unwritable. A marker at MAX_WIPE_ATTEMPTS
 *   is abandoned with an error log instead of wiping again.
 * - The wipe mode is decided once, recorded in the marker by the same
 *   durable write, and reused on retries — see {@link decideWipeMode} for
 *   why re-deriving it per pass is wrong.
 * - Deletion failures on entries outside USER_DATA_KEEP are critical. With
 *   attempts left, the gate relaunches straight back into preboot to retry
 *   — a pending marker must never coexist with a writable app, or the
 *   retry pass would delete data the user created in between. At the cap
 *   it gives up: marker cleared, failure surfaced in a dialog, boot
 *   continues over whatever remains.
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

    // Same source as the write side (app.factory_reset.request) — the marker
    // path check below is a strict string comparison, so both sides must read
    // the registry, not raw Electron (pathRegistry is the single source of
    // truth and could normalize paths someday).
    const userData = application.getPath('app.userdata')
    if (marker.userDataPath !== userData) {
      logger.warn('Factory reset marker belongs to a different userData directory — leaving it for that instance', {
        markerPath: marker.userDataPath,
        currentPath: userData
      })
      return
    }

    // boot-config.json is hand-editable and BootConfig has no runtime schema
    // validation. `attempts` feeds arithmetic, so a corrupted value (say "x")
    // would disable the cap entirely ('"x" >= 2' is false, '"x" + 1'
    // concatenates) — coerce instead of trusting the shape.
    const attempts = Number(marker.attempts) || 0
    if (attempts >= MAX_WIPE_ATTEMPTS) {
      logger.error('Factory reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        attempts
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      showIncompleteResetWarning()
      return
    }

    // Reuse the mode a previous pass recorded; decide (and record) it only
    // for the first pass. The marker is hand-editable JSON, so an unknown
    // recorded value falls back to a fresh decision instead of being trusted.
    const recordedMode = marker.mode !== undefined && WIPE_MODES.includes(marker.mode) ? marker.mode : undefined
    const mode = recordedMode ?? decideWipeMode(userData)

    logger.info('Factory reset pending — wiping user data', {
      userData,
      requestedAt: marker.requestedAt,
      attempt: attempts + 1,
      mode
    })

    // Arm the retry accounting BEFORE the destructive pass, so a crash
    // mid-wipe still counts against the cap. Must be a durable persist(), not
    // flush(): flush() swallows write failures, and an increment that never
    // reaches disk voids the cap — every boot would read attempts 0 and wipe
    // again, destroying whatever the user created in between. If the count
    // cannot be recorded, skip the destructive pass entirely; boot continues
    // and a later start (with a writable boot-config) picks the marker up.
    // The wipe-mode decision rides the same durable write.
    try {
      bootConfigService.set('temp.factory_reset', { ...marker, attempts: attempts + 1, mode })
      bootConfigService.persist()
    } catch (error) {
      logger.error('Factory reset skipped: the attempt count could not be durably recorded', {
        error: String(error)
      })
      return
    }

    const failures: string[] = []
    if (mode === 'tree') {
      wipeDirectoryEntries(userData, (entry) => !USER_DATA_KEEP.has(entry), failures)
    } else {
      logger.warn('userData failed the whole-tree safety check — using a manifest wipe', { userData, mode })
      const manifest =
        mode === 'owned-manifest' ? [...USER_DATA_MANIFEST, ...OWNED_MANIFEST_EXTRAS] : USER_DATA_MANIFEST
      wipeDirectoryEntries(userData, (entry) => manifest.includes(entry), failures)
    }
    wipeDirectoryEntries(CHERRY_HOME, (entry) => CHERRY_HOME_WIPE.includes(entry), failures)
    // The OVMS model registry is user-authored configuration living inside
    // the kept ovms/ machine-artifact tree (see CHERRY_HOME_WIPE). Its
    // removal is as critical as the wipe lists above: clearing the marker
    // over a locked registry would declare a reset complete while the next
    // boot still loads the user's model setup (#17138 review).
    removeEntry(application.getPath('feature.ovms.model_registry_file'), failures)
    wipeNonCriticalExtras()

    if (failures.length > 0) {
      // Never boot into a writable state on a pending marker: data the user
      // creates in a half-wiped app would be deleted by the retry pass on
      // the next start (#17138 review).
      if (attempts + 1 < MAX_WIPE_ATTEMPTS) {
        logger.error('Factory reset pass had critical failures — relaunching to retry in preboot', { failures })
        // app.relaunch + app.exit (not application.*): no before-quit
        // handlers may write files after the wipe.
        app.relaunch()
        app.exit(1)
        return
      }
      // Out of attempts: give up NOW instead of leaving the marker pending.
      // The clear rides flush() — a lost write is re-cleared by the cap
      // path on the next boot without another destructive pass.
      logger.error('Factory reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        failures
      })
      resetBootConfigToDefaults()
      bootConfigService.flush()
      showIncompleteResetWarning()
      return
    }

    // Reset BootConfig to defaults — which also clears the marker
    // (DefaultBootConfig['temp.factory_reset'] is null). Known residual:
    // configureChromiumFlags() already ran at module load (a tested
    // ordering invariant — see main.ts) with the pre-reset
    // app.disable_hardware_acceleration value, so this session keeps the
    // old flag; the next launch self-heals. Deliberately keeps
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

    logger.info('Factory reset completed — continuing boot with a fresh state')
  } catch (error) {
    logger.error('Factory reset gate failed — continuing boot', error as Error)
  }
}

/**
 * Decide how much of userData a destructive pass may remove. 'tree'
 * (everything except USER_DATA_KEEP) requires a directory whose children's
 * deletion cannot plausibly destroy non-Cherry data: not the user's home
 * directory or an ancestor of it, not a filesystem root or other near-root
 * path, not ~/.cherrystudio itself, and carrying the ownership sentinel
 * that proves the app actually ran here. Sentinel-proven directories with
 * a risky shape degrade to 'owned-manifest'; everything else gets the
 * strict 'manifest'.
 *
 * The decision is recorded in the marker on the first pass and REUSED on
 * retries (see the caller): the first pass deletes the sentinel this
 * decision derives from, so re-deriving after a crash mid-wipe would
 * silently downgrade a tree wipe to a manifest wipe — skipping the
 * entries the crashed pass never reached — and then declare success.
 *
 * All checks run on canonicalized paths ({@link canonicalize}): the wipe
 * follows symlinks/junctions to their target, so the safety judgment must
 * be made on that target, not on the lexical alias (#17138 review).
 */
function decideWipeMode(userData: string): WipeMode {
  const normalized = canonicalize(userData)
  const home = canonicalize(os.homedir())
  // Home and its ancestors never get the owned manifest either, sentinel or
  // not: entries like 'Data' or '.claude' in a home directory are
  // overwhelmingly the user's own.
  if (isSamePath(normalized, home)) return 'manifest'
  if (isPathInside(home, normalized)) return 'manifest'
  if (!fs.existsSync(path.join(normalized, OWNERSHIP_SENTINEL))) return 'manifest'
  // Near-root paths (e.g. '/', 'C:\\', '/Users', 'D:\\data') are never
  // tree-wiped even if the app ran there — the blast radius of a mistake
  // is the whole disk. Portable builds with a shallow data dir get the
  // owned manifest instead.
  const segments = normalized.split(path.sep).filter(Boolean)
  if (segments.length < 3) return 'owned-manifest'
  // userData pointed at ~/.cherrystudio itself: a tree pass would take the
  // kept machine artifacts (bin/, binary-manager/, ovms/, install/) and
  // boot-config.json — the marker included — down with it.
  if (isSamePath(normalized, canonicalize(CHERRY_HOME))) return 'owned-manifest'
  return 'tree'
}

/**
 * Filesystem identity for the safety checks above: resolve symlinks and
 * junctions so an alias of the home directory cannot pass the lexical
 * checks while rmSync follows the link into home itself. `.native` also
 * restores the on-disk casing on Windows. A path realpath cannot resolve
 * either does not exist (cannot be an alias; the sentinel check fails it
 * into 'manifest' anyway) or is unreadable (the wipe itself then fails
 * loudly into the retry/give-up path) — lexical resolve is enough there.
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
 * Windows and macOS default filesystems are case-insensitive: 'c:\users'
 * and 'C:\Users' are the same directory, and a string comparison must not
 * treat them as different. Folding case can only misjudge two genuinely
 * distinct paths as equal (case-sensitive volumes on those platforms),
 * which degrades the decision toward a safer mode — never toward 'tree'.
 */
const FOLD_CASE = process.platform === 'win32' || process.platform === 'darwin'

function foldCase(p: string): string {
  return FOLD_CASE ? p.toLowerCase() : p
}

function isSamePath(a: string, b: string): boolean {
  return foldCase(a) === foldCase(b)
}

/** Is `child` strictly inside `dir`? Both must already be canonicalized. */
function isPathInside(child: string, dir: string): boolean {
  return foldCase(child).startsWith(foldCase(dir) + path.sep)
}

/**
 * Tell the user the reset gave up with data left behind. Shown
 * synchronously before any window exists — Electron supports showErrorBox
 * pre-ready. Hardcoded English like the gate's other dialog: preboot runs
 * before main-process i18n is initialized.
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
    removeEntry(path.join(dir, entry), failures)
  }
}

/** rm with failure accounting — a recorded failure keeps the marker pending. */
function removeEntry(target: string, failures: string[]): void {
  try {
    fs.rmSync(target, RM_OPTIONS)
  } catch (error) {
    logger.warn('Failed to remove entry during factory reset', { target, error: String(error) })
    failures.push(target)
  }
}

/**
 * Best-effort cleanup whose failure must not block the reset: `app.temp`
 * ({os.tmpdir}/CherryStudio) holds no user data that survives a reboot in
 * a meaningful way — the "Clear cache" feature clears it, and a factory
 * reset must be a superset of Clear cache.
 */
function wipeNonCriticalExtras(): void {
  const tempDir = application.getPath('app.temp')
  try {
    fs.rmSync(tempDir, RM_OPTIONS)
  } catch (error) {
    logger.warn('Failed to remove non-critical entry during factory reset', { target: tempDir, error: String(error) })
  }
  // getPath('app.temp') above auto-ensured the directory and cached the key
  // (Application#ensuredKeys caches even on failure), so nothing else in this
  // process will ever re-create it — and the process that runs the gate is the
  // very session the user keeps using after the reset. Without this mkdir,
  // every app.temp consumer (office attachment parsing, Clear cache, image
  // compression) hits ENOENT until the next restart. Same post-rm recreate as
  // FileStorage.clearTemp.
  try {
    fs.mkdirSync(tempDir, { recursive: true })
  } catch (error) {
    logger.warn('Failed to recreate the app temp dir after factory reset', { tempDir, error: String(error) })
  }
}
