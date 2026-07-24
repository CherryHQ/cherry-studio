import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { SHUTDOWN_TIMEOUT_MS } from '@main/core/lifecycle'
// Request side only: t resolves the language through PreferenceService,
// which exists in the live app but NOT at preboot — the execution side's
// dialogs below are deliberately hardcoded en-US instead.
import { t } from '@main/i18n'
import { dialog, session } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('DataReset')

/**
 * Data Reset (#17131): erase Cherry's user data and boot a fresh-install
 * state. One capability, two faces sharing this module:
 *
 * - {@link requestDataReset} — the running app confirms the request, writes
 *   the pending-marker file into userData, clears live Chromium storage, and
 *   relaunches through a graceful shutdown.
 * - {@link runDataReset} — the next process consumes the marker at preboot
 *   timing (called from main.ts before any other gate reads user data),
 *   because a running process cannot delete files it still holds open.
 *
 * The marker is a small JSON file at the userData root
 * (registered as `feature.data_reset.marker_file`): its presence arms a wipe,
 * and its
 * *location* — the userData directory that physically contains it — is the
 * authorization. There is no cross-instance "which userData" field; a marker
 * only ever wipes the tree it sits in. // whitelist wipe only; a whole-tree
 * wipe mode requires redesigning this marker first
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
 * NOTE: the pending-marker file itself is deliberately NOT listed — it must
 * survive its own wipe pass so the success path can commit the durable
 * `completed` terminal record over it (a wiped-then-missing marker is
 * indistinguishable from a never-armed one). runDataReset disarms it
 * explicitly after a clean pass.
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
 *
 * Data Reset's own sidecar residue is also deliberately retained (kept by
 * the whitelist simply not naming it) — known artifacts of this module,
 * classified as diagnostics rather than unknown debris (#17138 review):
 * - `data-reset.pending.invalid` — an invalid marker quarantined by
 *   readMarker, kept as evidence for diagnosis.
 * - `data-reset.pending.json.tmp-*` — writeMarker's temp file, orphaned only
 *   if the process dies mid-write (the failure path unlinks it otherwise);
 *   inert, never read back.
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
 * The marker's on-disk shapes, versioned and strict. Module-private —
 * nothing outside this file reads them, so they do not belong in @shared.
 * The marker is a persistent destructive authorization, so parsing is
 * deliberately unforgiving: unknown fields, unknown statuses, or a
 * missing/unknown version fail validation wholesale and are quarantined by
 * readMarker instead of being partially accepted (#17138 review).
 *
 * `pending` arms a wipe. `canonicalPath` is REQUIRED (unlike a plain
 * userData string): a pass whose realpath re-resolution disagrees with it
 * refuses to wipe, so a replaced symlink/junction cannot redirect a recorded
 * authorization onto a new directory (#17138 review). There is no
 * `userDataPath` field — the marker file's own location is the "which
 * userData" answer. `attempts` is constrained to a non-negative integer so a
 * hand-edited value cannot re-open the retry cap.
 *
 * `completed` is the durable terminal record a clean pass commits over the
 * pending marker BEFORE removing it: completion must be positive on-disk
 * state, not the absence of a file, because an unlink's durability cannot be
 * proven (see the success path in runDataReset). A resurrected completed
 * marker is recognized as "done" and never authorizes another wipe.
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

/** A marker rename landed, but its parent-directory fsync did not complete. */
class MarkerCommitError extends Error {
  constructor(error: unknown) {
    super(`Data reset marker may have committed: ${String(error)}`)
  }
}

/** Absolute path of the pending-marker file (parent dir auto-ensured). */
function markerPath(): string {
  return application.getPath('feature.data_reset.marker_file')
}

/**
 * Read and validate the pending marker.
 *   - absent (ENOENT) → null (no reset pending; boot normally).
 *   - present but invalid (bad JSON or failing the schema) → rename it aside
 *     to `data-reset.pending.invalid`, return null.
 *   - unreadable or unable to quarantine an invalid marker → throw: a marker
 *     may never coexist with a writable app.
 *
 * Renaming a validated-invalid marker rather than refusing to boot is
 * deliberate: it cannot drive a wipe (there is no trusted canonicalPath to
 * authorize one), and the quarantine keeps the evidence for diagnosis.
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

/** Move an invalid marker to `data-reset.pending.invalid` durably. */
function renameMarkerAside(file: string): void {
  fs.renameSync(file, path.join(path.dirname(file), 'data-reset.pending.invalid'))
  syncParentDirectory(file)
}

/**
 * Durable atomic write: a unique temp file in the marker's directory,
 * fsync'd through its descriptor, then rename'd over the marker and its
 * parent directory. A failure after rename is reported distinctly because
 * callers must not continue writable over a possibly committed marker.
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
    // Best-effort cleanup so a failed pre-commit write does not litter
    // userData with an orphan temp file.
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore — the temp file may never have been created
    }
    if (renamed) throw new MarkerCommitError(error)
    throw error
  }
}

/**
 * Fsync a marker's parent directory so a rename or unlink survives power
 * loss. Windows is a deliberate ceiling: Node exposes no supported way to
 * make directory metadata durable there (fs.rename has no write-through
 * mode, and fsync on a directory handle is not a documented Windows
 * contract), so this returns without a barrier and rename/unlink durability
 * is whatever the volume provides — NTFS metadata journaling in the common
 * case, nothing on FAT/exFAT or network shares. Remaining exposure on such
 * volumes: a power loss that rolls back the pending→completed transition
 * after the app already booted writable. Upgrade trigger: a Node API
 * offering write-through rename or directory metadata flush on Windows.
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

/**
 * Remove the marker. ENOENT is success (already gone). Any other error
 * throws: the marker provably still exists, and what that means is the
 * caller's contract —
 * - the give-up paths (path mismatch, attempt cap) let the throw propagate
 *   to runDataReset's outer catch, which force-exits: fail closed rather
 *   than boot writable over a still-pending marker;
 * - the terminal-state paths (clearing a `completed` marker after a clean
 *   pass, or one resurrected on a later boot) catch and tolerate it: a
 *   completed marker authorizes nothing, so a survivor is inert.
 */
function deleteMarker(): void {
  const file = markerPath()
  try {
    fs.unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // Also sync an already-absent marker: a prior unflushed unlink may be the
  // reason it is absent from the live directory view.
  syncParentDirectory(file)
}

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
 * The marker is written durably (atomic temp-file + rename) before the
 * shutdown sequence starts, so a failed write rejects the request instead of
 * relaunching without a staged marker.
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
  // Pin the physical directory the user confirmed: the wipe refuses a pass
  // whose realpath resolution has changed since this moment. A pre-commit
  // write failure rejects; a post-rename failure relaunches immediately so a
  // possibly committed marker never coexists with a writable app.
  try {
    writeMarker({
      version: 1,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      canonicalPath: canonicalize(userDataPath)
    })
  } catch (error) {
    if (!(error instanceof MarkerCommitError)) throw error
    // The marker is visible after rename even though its crash durability
    // could not be confirmed. Treat it as committed and continue through the
    // same guarded clear + graceful shutdown path; a bare relaunch would leave
    // lifecycle-owned child processes holding files the wipe must remove.
    logger.error('Data reset marker committed without durable directory metadata — relaunching safely', {
      error: String(error)
    })
  }

  // Semantic Chromium clear while the sessions are alive — the layer the
  // preboot pass cannot provide (it can only rm the storage directories it
  // knows by name; this API call covers whatever the running Chromium
  // actually persisted). Best-effort by design: the marker is already
  // durable, and runDataReset's rm pass is the deterministic layer.
  await clearChromiumState()

  // Graceful shutdown-then-relaunch, composed here from Application's
  // public API rather than a bare relaunch(): running services (OVMS and
  // friends) must release their child processes and file handles before
  // the next boot's wipe deletes the files they may hold open. NOT
  // app.quit(): quit-prevention (before-quit gate) could cancel the quit
  // and leave the app running over the already-staged marker. The timeout
  // mirrors Application's signal handlers — a hung service must not block
  // the relaunch.
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
 * Execution face (#17131). Consumes the pending-marker file written by
 * {@link requestDataReset}: deletes the {@link USER_DATA_WIPE} entries from
 * userData, commits a durable `completed` record over the marker, then
 * relaunches so the app boots a fresh-install state in a clean process.
 *
 * Scope: this userData profile only. `~/.cherrystudio` is machine domain
 * (tool binaries, models, OVMS registry, config/mcp/trace) and is
 * deliberately untouched (#17138 maintainer decision); the retained
 * credentials there are documented in the breaking-changes entry. BootConfig
 * is part of that machine domain and is NOT touched either: boot-config.json
 * is a machine-global control-plane file shared by instances using different
 * userData directories, and BootConfigService persists whole-file snapshots,
 * so writing it from a per-profile wipe could overwrite another instance's
 * concurrent update (#17138 review).
 *
 * Timing contract: runs at the top of startApp() — after
 * requireSingleInstance() (destructive fs operations must hold the
 * single-instance lock) and the frozen path registry, before
 * runBackupRestoreGate() (a data reset supersedes any staged restore —
 * the wipe removes the restore journal and staging tree).
 *
 * Failure semantics — bounded retry, no journal:
 * - `attempts` is durably re-written (atomic marker rewrite) before each
 *   destructive pass. If that write fails runDataReset QUITS: a pending
 *   marker must never coexist with a writable app, or data the user creates
 *   would be deleted by a later pass (#17138 review).
 * - The physical identity of the target is pinned in the marker
 *   (`canonicalPath`, realpath-resolved); a pass whose re-resolution
 *   disagrees refuses to wipe — a replaced symlink/junction must not
 *   redirect a recorded authorization onto a new directory (#17138 review).
 * - Deletion failures are critical. With attempts left, the pass relaunches
 *   straight back into preboot to retry. At the cap it gives up: marker
 *   removed, failure surfaced in a dialog, boot continues over whatever
 *   remains.
 * - After a clean pass a durable `completed` record is committed over the
 *   marker via the same atomic write path, and only then is the file
 *   removed, best-effort: completion is positive durable state, never the
 *   unprovable absence of a file. A failed completion commit quits (the
 *   durable on-disk state may still be `pending`); a failed removal is
 *   tolerated (a resurrected `completed` marker is recognized and inert).
 *   A later boot that READS a completed marker re-commits it durably before
 *   tolerating anything, since the boot that wrote it may have quit exactly
 *   because durability could not be proven (sol review).
 * - It then relaunches: the reset session must not keep running in the
 *   process that wiped it (stale Chromium flags, cached ensured paths); the
 *   next boot starts fresh with no marker.
 * Anything unexpected fails closed: a marker may never coexist with a
 * writable app.
 */
export function runDataReset(): void {
  try {
    const marker = readMarker()
    // No marker file in this userData → nothing pending, boot normally. The
    // marker's location IS the ownership, so there is no cross-instance check.
    if (!marker) return

    // A completed terminal record is a finished reset whose best-effort
    // removal did not survive (an unproven unlink can be rolled back by a
    // crash). The record exists precisely so this boot recognizes the reset
    // as done instead of re-wiping data created since.
    if (marker.status === 'completed') {
      logger.info('Found a completed data reset marker — clearing it and booting normally', {
        completedAt: marker.completedAt
      })
      // The record was READ from the live directory, but nothing on THIS
      // boot has proven it durable — the boot that wrote it may have quit on
      // a failed directory sync, leaving `pending` as the last state known
      // persisted. Re-commit it through the same atomic write path before
      // tolerating anything; a failure propagates to the outer catch and
      // quits, because booting writable while the durable state may still be
      // `pending` reopens exactly the resurrection wipe this record exists
      // to prevent (sol review).
      writeMarker(marker)
      // Durability proven — removal is genuinely best-effort from here: a
      // survivor or resurrected file reads as `completed` and is inert.
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

    // Physical identity check: the wipe follows the path the filesystem
    // resolves, so authorization must be bound to that resolution, not to
    // the string. A mismatch means a symlink/junction/mount changed between
    // the request (or a previous pass) and now — refuse and clear.
    const actualCanonical = canonicalize(userData)
    if (marker.canonicalPath !== actualCanonical) {
      logger.error('Data reset refused: userData resolves to a different physical directory than recorded', {
        recorded: marker.canonicalPath,
        actual: actualCanonical
      })
      refuseResetForPathMismatch()
      return
    }

    // The schema guarantees `attempts` is a non-negative integer or absent
    // (negative, fractional, or non-number values are quarantined as invalid
    // in readMarker), so this just maps absence to 0.
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

    // Arm the retry accounting BEFORE the destructive pass, so a crash
    // mid-wipe still counts against the cap. If the count cannot be durably
    // recorded, QUIT — booting on would leave a pending marker coexisting
    // with a writable app, and a later pass would delete whatever the user
    // created in between (#17138 review). The canonical identity rides the
    // same durable write.
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
        // Application.relaunch() schedules the platform-correct replacement
        // process and exits directly, without before-quit handlers writing
        // files after the wipe.
        application.relaunch()
        return
      }
      // Out of attempts: give up NOW instead of leaving the marker pending.
      // If clearing the marker fails, the throw reaches the outer catch and
      // the app quits — fail closed rather than boot writable over a marker
      // that could arm another pass.
      logger.error('Data reset abandoned: attempt cap reached with critical failures — clearing the marker', {
        failures
      })
      abandonIncompleteReset()
      return
    }

    // Commit the durable terminal record BEFORE removing the marker: an
    // unlink's durability cannot be proven, and a crash after an unproven
    // unlink can resurrect the pending marker and re-authorize a wipe of
    // data created after the reset (#17138 review). The record rides the
    // same atomic write path as the pending marker (rename over it). Any
    // failure — including a rename that landed without a durable directory
    // sync — quits: the durable on-disk state may still be `pending`.
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

    // With the terminal record durable, removal is genuinely best-effort: if
    // the unlink (or its directory sync) does not survive, the next boot
    // reads `completed` and clears it without wiping anything.
    try {
      deleteMarker()
    } catch (error) {
      logger.warn('Could not remove the completed data reset marker — the next boot will clear it', {
        error: String(error)
      })
    }

    // Relaunch instead of continuing: the marker is disarmed, so the next boot
    // is a normal fresh-install boot — in a clean process whose
    // module-top-level Chromium flags are read fresh (#17138 suggestion).
    // No loop: an absent or completed marker arms nothing on the next pass.
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

/**
 * Refuse a reset whose target no longer has the physical identity the user
 * confirmed. No destructive pass ran, so only the stale authorization is
 * disarmed before allowing startup. A deleteMarker failure propagates to the
 * outer catch and quits — never boot writable over a pending marker.
 */
function refuseResetForPathMismatch(): void {
  deleteMarker()
  showPathMismatchWarning()
}

/**
 * Give up after the attempt cap: disarm the marker so later user data is not
 * deleted by another automatic pass, and tell the user what remains. A
 * deleteMarker failure propagates to the outer catch and quits — fail closed
 * rather than boot writable over a still-pending marker.
 */
function abandonIncompleteReset(): void {
  deleteMarker()
  showIncompleteResetWarning()
}

/** Show a preboot-native error and terminate without running quit handlers. */
function showDataResetError(title: string, message: string): void {
  dialog.showErrorBox(title, message)
  application.forceExit(1)
}

/** Whitelist membership: exact names only. */
function shouldWipe(entry: string): boolean {
  return USER_DATA_WIPE.includes(entry)
}

/**
 * Clear every storage kind of the sessions Cherry uses (the same pair the
 * "Clear cache" feature targets: default + the miniapp webview partition).
 * No `storages` filter — a data reset clears everything the API knows,
 * including kinds a future Chromium adds. The whole best-effort pass is
 * bounded because its marker is already armed: a stuck Electron promise must
 * not leave the writable app running indefinitely before shutdown begins.
 */
async function clearChromiumState(): Promise<void> {
  const clearSessions = async () => {
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

  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      clearSessions(),
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

/**
 * Filesystem identity for the marker binding: resolve symlinks and junctions
 * so the wipe authorization sticks to the physical directory the request
 * targeted. `.native` also restores the on-disk casing on Windows. Failure
 * is intentionally propagated: lexical fallback would turn a failed identity
 * check into authorization for whichever target the path resolves to later.
 */
function canonicalize(p: string): string {
  return fs.realpathSync.native(path.resolve(p))
}

/**
 * Tell the user that a stale authorization was cancelled without deleting
 * data. Deliberately hardcoded en-US: this runs at preboot, before
 * PreferenceService exists, while the main i18n translation helper resolves
 * the active locale through that service.
 */
function showPathMismatchWarning(): void {
  dialog.showErrorBox(
    'Data Reset Cancelled',
    'Cherry Studio did not run Data Reset because the data location changed after confirmation.\n\n' +
      'No data was removed, and the pending request has been cleared. ' +
      'Run Data Reset again from Settings if you still want to erase this profile.'
  )
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
