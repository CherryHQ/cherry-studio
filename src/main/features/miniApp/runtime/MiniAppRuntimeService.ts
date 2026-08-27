/**
 * Owns everything per-running-mini-app: the session partition, the protocol and
 * network policy on it, and the webContents -> appId map the bridge uses to
 * authenticate callers.
 *
 * That map is the security-critical part — a guest-supplied appId is never trusted.
 */

import path from 'node:path'

import { application } from '@application'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage } from '@main/i18n'
import type { CacheMiniAppAttention } from '@shared/data/cache/cacheValueTypes'
import { MINI_APP_BRIDGE_CHANNEL, MINI_APP_STREAM_CHANNEL } from '@shared/ipc/schemas/miniAppBridge'
import { MINI_APP_SCHEME, MiniAppManifestSchema, resolveLocalizedText } from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'
import { session, webContents } from 'electron'

import { ACTIVITY_COUNT_FLUSH_MS, miniAppActivityLog } from '../activityLog'
import { aiCapability } from '../capabilities/ai'
import { pendingDeclaredAdditions } from '../grants'
import { sweepAbandonedStaging } from '../install/installer'
import { recoverInterruptedPublishes } from '../install/publishJournal'
import { miniAppInstallPath } from '../paths'
import { handleBridgeRequest } from './bridge'
import { emitToApp, emitToGuest } from './events'
import { installNetworkPolicy } from './network'
import { createMiniAppProtocolHandler } from './protocol'

const logger = loggerService.withContext('MiniAppRuntimeService')

/** How long to wait for guests to unmount after the eviction broadcast. */
export const QUIESCE_TIMEOUT_MS = 2000
const GUEST_POLL_INTERVAL_MS = 25

/**
 * Everything Chromium stored for this app that no table knows about.
 *
 * The CSP `sandbox` (design §4.2.1) stops the PAGE from writing Web Storage, but once
 * the app is allowed a network domain, cookies and the HTTP cache accumulate in its
 * session anyway — and they are attached to the partition, not to the `mini_app` row,
 * so nothing cascades them. Skipping this makes "reset" and "uninstall" untrue: the
 * server's tracking cookie survives, and a reinstall of the same appId resumes the
 * old identity.
 *
 * Callers must already be inside `withAppQuiesced`: a live guest would write straight
 * back into what this just cleared.
 */
export async function clearMiniAppPartition(appId: string): Promise<void> {
  const sess = session.fromPartition(miniAppPartition(appId))
  await sess.clearStorageData()
  await sess.clearCache()
  // `clearCodeCaches`, plural — the singular does not exist on Session.
  await sess.clearCodeCaches({ urls: [] })
}

export function miniAppPartition(appId: string): string {
  return `persist:miniapp:${appId}`
}

/**
 * A capability call's claim on the world it started in. `generation` changes every time
 * the app is taken offline, so a stale lease can never be revalidated. See `leaseFor`.
 */
export interface CallLease {
  readonly appId: string
  readonly generation: number
}

/**
 * Thrown when a capability call meets an app that is being taken offline.
 *
 * Deliberately NOT in `grants.ts`: `PermissionDeniedError` lives there because it is a
 * product of the authorization decision. This one is a product of runtime state, and
 * the two have no common home.
 */
export class MiniAppQuiescingError extends Error {
  constructor(readonly appId: string) {
    super(`Mini app ${appId} is being taken offline`)
    this.name = 'MiniAppQuiescingError'
  }
}

@Injectable('MiniAppRuntimeService')
@ServicePhase(Phase.WhenReady)
export class MiniAppRuntimeService extends BaseService {
  private readonly readyPartitions = new Set<string>()
  private readonly preparing = new Map<string, Promise<void>>()
  /** `webContentsId -> appId`. Membership doubles as the guest's liveness flag. */
  private readonly guestAppIds = new Map<number, string>()
  /** AI streams this guest started, so they can be aborted when it dies (Task 21). */
  private readonly guestStreams = new Map<number, Set<string>>()
  /** `hostWebContentsId:appId` → what the pool last reported; a guest attaching later inherits it. */
  private readonly paneVisibility = new Map<string, boolean>()
  /** Per guest, the last state it was told, so a repeated report emits nothing. */
  private readonly guestVisible = new Map<number, boolean>()
  /** The activity log's clock, running only while some app runs — see `registerGuest`. */
  private flushTimer: Disposable | undefined
  private readonly quiescingAppIds = new Set<string>()
  /** Bumped every time the app is taken offline — see `CallLease`. */
  private readonly appGeneration = new Map<string, number>()
  private readonly sessionAppIds = new WeakMap<Electron.Session, string>()

  /**
   * The service's ONE `onReady`. Every mini-app wiring lands here — a second
   * definition on the same class silently replaces this one, and what it would drop
   * is the crash recovery.
   *
   * All of it belongs here rather than at module load: `ipcOn`/`ipcHandle` are
   * auto-cleaned on stop/destroy, and recovery needs DbService (a BeforeReady
   * service, so it is up by the time this runs).
   */
  protected async onReady(): Promise<void> {
    // 1. Capability bridge (Task 23).
    this.ipcHandle(MINI_APP_BRIDGE_CHANNEL, async (event, payload) => {
      const requestId = (payload as { requestId?: string })?.requestId
      const emit = (chunk: string) => {
        if (requestId) event.sender.send(MINI_APP_STREAM_CHANNEL, { requestId, chunk })
      }
      return handleBridgeRequest(event.sender.id, payload, emit)
    })

    // 2. Host-pushed locale changes (Task 24) — `languagechange` does not fire for
    //    an `acceptLanguages` change, measured on Electron 41.
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('app.language', () => {
        // The callback's own value is the raw preference and can be null. Re-resolve,
        // so the guest sees the same locale `app.getInfo` reports.
        const locale = getAppLanguage()
        for (const appId of this.installedAppIds()) emitToApp(appId, 'app.localeChange', { locale })
      })
    )

    // 3. A release can add a method inside a namespace an app declared with a
    //    wildcard. Reconcile at startup; the answer is DERIVED, not stored.
    this.broadcastAttentionState()

    // 4. Repair anything a crash left mid-publish, then drop staging trees — in a
    //    freshly started process every `.staging-*` is by definition abandoned.
    await recoverInterruptedPublishes()
    await sweepAbandonedStaging()
  }

  /**
   * Idempotent, and ASYNC: `session.setProxy()` returns a Promise and the proxy is
   * only in effect once it resolves. `will-attach-webview` is synchronous, so the
   * renderer must await `mini_app.runtime.prepare` before mounting the <webview> — attaching
   * first and configuring after would let the first load run un-proxied.
   */
  async ensurePartition(appId: string): Promise<void> {
    const partition = miniAppPartition(appId)
    if (this.readyPartitions.has(partition)) return

    // Concurrent prepares must share ONE registration: `readyPartitions` is set only
    // after the await, so every concurrent caller sails past it.
    const inflight = this.preparing.get(partition)
    if (inflight) return inflight

    const run = (async () => {
      const sess = session.fromPartition(partition)
      try {
        // Everything failable runs FIRST: `protocol.handle` is irreversible per
        // session, so a later failure would leave the app permanently unloadable.
        await installNetworkPolicy(sess, appId)
        sess.protocol.handle(
          MINI_APP_SCHEME,
          createMiniAppProtocolHandler(appId, (id) => this.resolveInstallPath(id))
        )
      } catch (error) {
        // Belt and braces: if the registration itself is what failed halfway, leave
        // the session clean so the retry starts from nothing.
        try {
          sess.protocol.unhandle(MINI_APP_SCHEME)
        } catch {
          // Never registered — nothing to undo.
        }
        throw error
      }
      this.sessionAppIds.set(sess, appId)
      this.readyPartitions.add(partition)
      logger.debug('Prepared mini app partition', { partition })
    })()

    this.preparing.set(partition, run)
    try {
      await run
    } finally {
      // A failed prepare must not stay cached, or the app could never load again.
      this.preparing.delete(partition)
    }
  }

  /**
   * The bridge preload, used ONLY by `will-attach-webview`.
   *
   * The renderer never receives it and never sets `preload` on the element. Two
   * reasons, the second load-bearing:
   *   1. The element's `preload` ATTRIBUTE takes a `file:` URL, not a filesystem
   *      path, so routing a path through the renderer invites a value that is
   *      silently invalid — and an invalid preload is a guest with no bridge.
   *   2. A privileged main-process path has no business in a renderer. Main owns
   *      this decision; handing it out and validating what comes back is a round
   *      trip whose only product is a chance to disagree.
   */
  // `.js`, not `.mjs` — `will-attach-webview` compares this string for equality, so a
  // wrong extension is a webview that silently refuses to attach.
  readonly bridgePreloadPath = path.join(__dirname, '../preload/miniAppBridge.js')

  /**
   * `did-attach-webview` fires before navigation, so `contents.getURL()` is empty
   * there — the session is the only identity available at that moment.
   */
  resolveAppIdBySession(guestSession: Electron.Session): string | undefined {
    return this.sessionAppIds.get(guestSession)
  }

  isPartitionReady(appId: string): boolean {
    return this.readyPartitions.has(miniAppPartition(appId))
  }

  protected async onStop(): Promise<void> {
    await miniAppActivityLog.flush()
  }

  registerGuest(appId: string, webContentsId: number): void {
    // The activity log has no clock of its own, and an idle host should not tick for it:
    // the first guest starts the minute flush, the last one leaving stops it.
    if (this.guestAppIds.size === 0) {
      this.flushTimer = this.registerInterval(() => miniAppActivityLog.flush(), ACTIVITY_COUNT_FLUSH_MS)
    }
    this.guestAppIds.set(webContentsId, appId)
    this.guestStreams.set(webContentsId, new Set())
    // Shown unless the pool said otherwise: a guest attaches because a pane rendered it.
    const hostId = webContents.fromId(webContentsId)?.hostWebContents?.id
    this.guestVisible.set(
      webContentsId,
      hostId === undefined ? true : (this.paneVisibility.get(`${hostId}:${appId}`) ?? true)
    )
  }

  /**
   * The pool's report: in host window `hostWebContentsId`, `appId`'s pane is shown or hidden.
   * Guests cannot see `display: none` — Page Visibility never fires — so this is the only
   * source of `app.visibilityChange`. Delivered to the guests of THAT window alone: the same
   * app in a detached window has its own pane and its own report.
   */
  setPaneVisible(hostWebContentsId: number, appId: string, visible: boolean): void {
    this.paneVisibility.set(`${hostWebContentsId}:${appId}`, visible)
    for (const [guestId, guestAppId] of this.guestAppIds) {
      if (guestAppId !== appId) continue
      if (webContents.fromId(guestId)?.hostWebContents?.id !== hostWebContentsId) continue
      if (this.guestVisible.get(guestId) === visible) continue
      this.guestVisible.set(guestId, visible)
      emitToGuest(guestId, 'app.visibilityChange', { visible })
    }
  }

  /** What the guest was last told. Unknown guests count as hidden — the gate, not the event, is the consumer. */
  isGuestVisible(webContentsId: number): boolean {
    return this.guestVisible.get(webContentsId) === true
  }

  /**
   * Forget a guest and kill everything the host was still doing on its behalf.
   *
   * Aborting is NOT a courtesy to the mini app — it is gone and will never see the
   * result. It is the host declining to keep paying a provider for output nobody
   * will read. `isAlive()` already detached the listener; the manager only
   * self-aborts when `backgroundMode === 'abort'`, which is a user preference, so
   * this has to be explicit.
   */
  unregisterGuest(webContentsId: number): void {
    const appId = this.guestAppIds.get(webContentsId)
    for (const streamId of this.guestStreams.get(webContentsId) ?? []) {
      application.get('AiStreamManager').abort(streamId, 'miniapp-guest-destroyed')
    }
    this.guestStreams.delete(webContentsId)
    this.guestAppIds.delete(webContentsId)
    this.guestVisible.delete(webContentsId)
    // The abort above never reaches a dead listener, so the calls settle here or never.
    aiCapability.forgetGuest(webContentsId)
    // The app's last instance is gone: its counts land now, not at the next minute.
    if (appId !== undefined && this.guestsOf(appId).length === 0) void miniAppActivityLog.flush(appId)
    if (this.guestAppIds.size === 0) {
      this.flushTimer?.dispose()
      this.flushTimer = undefined
    }
  }

  isGuestAlive(webContentsId: number): boolean {
    return this.guestAppIds.has(webContentsId)
  }

  rememberStream(webContentsId: number, streamId: string): void {
    this.guestStreams.get(webContentsId)?.add(streamId)
  }

  forgetStream(webContentsId: number, streamId: string): void {
    this.guestStreams.get(webContentsId)?.delete(streamId)
  }

  // Quiescing, read-only side. The WRITER (`withAppQuiesced`) is below; these live
  // here, next to the fields, because the bridge and the capabilities consult them.

  /** `prepare` and `will-attach-webview` both consult this and refuse. */
  isQuiescing(appId: string): boolean {
    return this.quiescingAppIds.has(appId)
  }

  private generationOf(appId: string): number {
    return this.appGeneration.get(appId) ?? 0
  }

  /**
   * Refuses a call that has not started yet. Cheap, synchronous, and the first of two
   * gates — this one only covers calls that arrive AFTER the mark goes up.
   */
  beginCapabilityCall(appId: string): void {
    if (this.quiescingAppIds.has(appId)) throw new MiniAppQuiescingError(appId)
  }

  /**
   * A capability call's claim on the world it started in.
   *
   * Taken at the START of any call that can outlive a tick, checked again at its point
   * of no return. A boolean "is quiescing right now" is NOT sufficient there: the host
   * does not wait for in-flight work (design §2.1), so a queued `file.save` can resume
   * AFTER the whole quiesce finished — at which point the mark is already gone and a
   * boolean check waves it through, writing the app's old state back over a `clear_data`.
   */
  leaseFor(appId: string): CallLease {
    return { appId, generation: this.generationOf(appId) }
  }

  /** Refuses a write whose world has changed since the call began. */
  assertLeaseValid(lease: CallLease): void {
    if (this.quiescingAppIds.has(lease.appId) || this.generationOf(lease.appId) !== lease.generation) {
      throw new MiniAppQuiescingError(lease.appId)
    }
  }

  /** Per-app quiesce serialization; declared HERE, with its only writer. */
  private readonly quiesceChain = new Map<string, Promise<void>>()

  /**
   * Takes a mini app offline, runs `mutate`, and leaves it offline.
   *
   * Every publish action changes something the RUNNING guest depends on — its
   * permissions, its files, its rows. Doing that underneath a live page is not a
   * race that usually works out: the old code is simply now running against a world
   * it was not built for, and in the permission case it is running with a grant the
   * user gave to different code.
   *
   * Deliberately does NOT restart the app afterwards. Reopening is the user's
   * action, and a silent auto-restart would hide the version change from them.
   */
  async withAppQuiesced<T>(appId: string, mutate: () => Promise<T>): Promise<T> {
    // Serialized per app, NOT via `withPublishLock` — `clear_data` and `reset` do not
    // take it. No cycle: the publish lock is always the outer one when both are held.
    const run = (this.quiesceChain.get(appId) ?? Promise.resolve()).then(async () => {
      // Marked BEFORE the first check: otherwise the renderer can `prepare` between
      // "no guests left" and the mutation, and attach old code onto changing files.
      this.quiescingAppIds.add(appId)
      try {
        return await this.quiesceThenMutate(appId, mutate)
      } finally {
        // Bump BEFORE clearing the mark, unconditionally: every earlier lease is now
        // stale FOREVER, not just for the window. That is the whole point.
        this.appGeneration.set(appId, this.generationOf(appId) + 1)
        this.quiescingAppIds.delete(appId)
      }
    })
    // Keep the chain alive past a rejection, or one failed uninstall poisons every
    // later quiesce for that app.
    this.quiesceChain.set(
      appId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  private async quiesceThenMutate<T>(appId: string, mutate: () => Promise<T>): Promise<T> {
    // Ask every pool to drop it: unmounting the <webview> is what ends the guest.
    // Destroying the contents first leaves the renderer holding a dead element.
    application.get('IpcApiService').broadcast('mini_app.runtime.evicted', { appId })
    await this.waitForNoGuests(appId, QUIESCE_TIMEOUT_MS)

    // A guest that did not go away gets DESTROYED: old code holding the new version's
    // grants is exactly what this function exists to prevent.
    for (const id of this.guestsOf(appId)) {
      logger.warn('Destroying a mini app guest that ignored the eviction broadcast', { appId, webContentsId: id })
      // `destroy` is real in Electron 41 but missing from its typings (only `close` is documented).
      const guest = webContents.fromId(id) as unknown as { destroy(): void } | undefined
      guest?.destroy()
      this.unregisterGuest(id)
    }

    // Deliberately does NOT wait for in-flight calls — that is the execution model.
    // They are refused at their write instead.
    // Offline now: the log is complete up to this moment, and the counts land BEFORE
    // whatever grant line the mutation writes.
    await miniAppActivityLog.flush(appId)
    return mutate()
  }

  /**
   * Polls until the app has no guests, or the timeout expires.
   *
   * Resolving on timeout is deliberate: the caller destroys whatever is left. A wedged
   * renderer must not be able to block the user's uninstall forever, and by this point
   * it has already been asked to unmount.
   */
  private async waitForNoGuests(appId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.guestsOf(appId).length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, GUEST_POLL_INTERVAL_MS))
    }
  }

  /** The ONLY way the bridge learns who is calling. */
  resolveAppIdBySender(webContentsId: number): string | undefined {
    return this.guestAppIds.get(webContentsId)
  }

  /** Every live guest of one app, across every window. */
  guestsOf(appId: string): number[] {
    return [...this.guestAppIds.entries()].filter(([, id]) => id === appId).map(([wc]) => wc)
  }

  /**
   * Recomputes "which apps need the user's attention" and pushes it to every window.
   *
   * DERIVED, never stored. Two things can want attention — a host-added leaf under a
   * declared wildcard, and an available update — and both are already answerable from
   * rows that exist (`consentedDeclaredJson` + `manifestJson`, and the update check's
   * own result). A `hasPendingBadge` column would be a third copy of that truth, and
   * the copy is the one that goes stale after a grant, a revoke, or a rollback.
   *
   * Called at startup, after `mini_app.grant.approve_pending`, and after any update check.
   */
  broadcastAttentionState(): void {
    application.get('IpcApiService').broadcast('mini_app.runtime.attention', { apps: this.appsNeedingAttention() })
  }

  /**
   * The app's display name, resolved against the HOST's language.
   *
   * Lives here rather than in either consumer: the AI usage attribution (Task 21) and
   * the notification prefix (Task 22) both need it, and a second copy of "read the
   * manifest, resolve the locale" is a second thing to get wrong.
   */
  displayNameOf(appId: string): string {
    const [row] = application
      .get('DbService')
      .getDb()
      .select({ manifestJson: miniAppInstallationTable.manifestJson })
      .from(miniAppInstallationTable)
      .where(eq(miniAppInstallationTable.appId, appId))
      .all()
    if (!row) return appId
    const manifest = MiniAppManifestSchema.parse(row.manifestJson)
    return resolveLocalizedText(manifest.name, getAppLanguage())
  }

  /**
   * Pull-based counterpart to the broadcast.
   *
   * Both are needed: a window that opens AFTER the startup broadcast never saw it, and
   * a broadcast-only design would leave that window with no badges until the next
   * grant or update check. `mini_app.detail` and the list route return this so the
   * first render is correct; the event keeps later renders correct.
   */
  attentionState(): CacheMiniAppAttention[] {
    return this.appsNeedingAttention()
  }

  /** The dot WITH its reasons: the tile's hover text and menu, and the panel's chip, read these. */
  private appsNeedingAttention(): CacheMiniAppAttention[] {
    const db = application.get('DbService').getDb()
    return db
      .select({
        appId: miniAppInstallationTable.appId,
        manifestJson: miniAppInstallationTable.manifestJson,
        consentedDeclaredJson: miniAppInstallationTable.consentedDeclaredJson
      })
      .from(miniAppInstallationTable)
      .all()
      .map((row) => ({
        appId: row.appId,
        updateVersion: this.updateAvailable.get(row.appId) ?? null,
        updating: this.updating.get(row.appId) ?? null,
        // Snoozed leaves stay pending in the panel; they just stop lighting the dot.
        pendingPermissions: this.snoozedPending.has(row.appId)
          ? []
          : pendingDeclaredAdditions(
              row.appId,
              MiniAppManifestSchema.parse(row.manifestJson),
              row.consentedDeclaredJson ?? []
            )
      }))
      .filter((entry) => entry.updateVersion !== null || entry.pendingPermissions.length > 0 || entry.updating !== null)
  }

  /**
   * Apps whose last update check found something, and which version. Process-local by
   * design: an update check is a fact about the network a moment ago, not about the
   * installation, and persisting it would mean showing a badge for an update that has
   * since been published-over or withdrawn.
   */
  private readonly updateAvailable = new Map<string, string>()
  /** "Not now" on host-added leaves: process-local like the update fact, so the reminder returns next launch. */
  private readonly snoozedPending = new Set<string>()

  /**
   * Every route that learns something about an app's update status calls this — the
   * on-open check, the manual check, a successful apply, and a rollback.
   *
   * All four, not just the first: a badge that only ever gets SET is a badge that
   * stays lit after the user has already updated, and one nobody trusts after that.
   * Apply and rollback both pass `null` because whatever was pending is now resolved
   * (rollback moved the app to a version the last check said nothing about).
   */
  noteUpdateAvailable(appId: string, version: string | null): void {
    if (version) this.updateAvailable.set(appId, version)
    else this.updateAvailable.delete(appId)
    this.broadcastAttentionState()
  }

  updateVersionOf(appId: string): string | null {
    return this.updateAvailable.get(appId) ?? null
  }

  /** Updates in flight and how far along. Process-local: a fact about right now, gone with the process. */
  private readonly updating = new Map<string, { version: string; fraction: number | null }>()

  /**
   * ONE update per app at a time, decided here and not in the renderer: a second click
   * during a long download would otherwise download again and fail at the publish lock.
   */
  beginUpdate(appId: string, version: string): void {
    if (this.updating.has(appId)) throw new Error(`Mini app ${appId} is already being updated`)
    this.updating.set(appId, { version, fraction: null })
    this.broadcastAttentionState()
  }

  /** Broadcast on every 2% step (and on completion), not on every chunk. */
  noteUpdateProgress(appId: string, fraction: number): void {
    const entry = this.updating.get(appId)
    if (!entry) return
    const clamped = Math.max(0, Math.min(1, fraction))
    if (entry.fraction !== null && clamped < 1 && clamped - entry.fraction < 0.02) return
    entry.fraction = clamped
    this.broadcastAttentionState()
  }

  endUpdate(appId: string): void {
    if (this.updating.delete(appId)) this.broadcastAttentionState()
  }

  snoozePending(appId: string): void {
    this.snoozedPending.add(appId)
    this.broadcastAttentionState()
  }

  /** A grant answers the reminder for good; the snooze must not outlive it. */
  clearPendingSnooze(appId: string): void {
    this.snoozedPending.delete(appId)
  }

  /**
   * Uninstall must not leave a badge behind for a row that no longer exists.
   *
   * The generation is deliberately KEPT: it must stay monotonic for the process. Dropping
   * it inside the uninstall's quiesce would let the trailing bump land back on 1 — equal
   * to a lease taken after one earlier quiesce, which would then pass its check.
   */
  forgetApp(appId: string): void {
    void miniAppActivityLog
      .forget(appId)
      .catch((error) => logger.warn('Could not remove a mini app activity log', { appId, error }))
    this.updateAvailable.delete(appId)
    this.snoozedPending.delete(appId)
    this.updating.delete(appId)
    this.broadcastAttentionState()
  }

  private installedAppIds(): string[] {
    return application
      .get('DbService')
      .getDb()
      .select({ appId: miniAppInstallationTable.appId })
      .from(miniAppInstallationTable)
      .all()
      .map((r) => r.appId)
  }

  /**
   * Derived, never read from the DB: userData relocation copies the whole tree
   * (database included), so a persisted absolute path goes stale for every app at once.
   * Returns undefined when the app has no installation row.
   */
  private resolveInstallPath(appId: string): string | undefined {
    const installed =
      application
        .get('DbService')
        .getDb()
        .select({ appId: miniAppInstallationTable.appId })
        .from(miniAppInstallationTable)
        .where(eq(miniAppInstallationTable.appId, appId))
        .all().length > 0
    return installed ? miniAppInstallPath(appId) : undefined
  }
}
