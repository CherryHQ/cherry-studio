import type { UpdateInfo } from 'builder-util-runtime'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { openExternalWebsite } from '@renderer/services/website'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

import { presentedRouteService } from './PresentedRouteService'

const logger = loggerService.withContext('AppUpdateCheckService')

export const OFFICIAL_RELEASES_URL = 'https://github.com/CherryHQ/cherry-studio/releases'

/** How long a manual check may stay "checking" when the updater emits nothing. */
export const UPDATE_CHECK_EVENT_WAIT_MS = 20_000

type UpdateSnapshot = Pick<CacheAppUpdateState, 'checking' | 'downloading' | 'downloaded' | 'info' | 'manualCheck'>
type UpdatePatch = Partial<CacheAppUpdateState>

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded'
type ChannelAck = 'ready' | 'failed'

class AppUpdateCheckService {
  private manualCheckActive = false
  private checkInFlight = false
  private phase: UpdatePhase = 'idle'
  private latestInfo: UpdateInfo | null = null
  private missingEventTimer: ReturnType<typeof setTimeout> | undefined
  private noticeKey: string | null = null
  private session = 0
  private activeSession = 0
  /** Session whose events stay inactive until the cancelling preference write settles. */
  private heldEpoch: number | null = null
  private channelAckWaiters: Array<(result: ChannelAck) => void> = []
  private readonly noticeListeners = new Set<() => void>()
  /** Manual click that currently owns the check slot. A later click replaces it. */
  private checkOwner = 0
  private nextCheckOwner = 0

  isManualUpdateCheck(): boolean {
    return this.manualCheckActive
  }

  /** Channel switches bump the session so an in-flight old release cannot reopen. */
  isActiveUpdateSession(): boolean {
    return this.heldEpoch === null && this.activeSession === this.session
  }

  readUpdateNotice = (): string | null => {
    return this.noticeKey
  }

  subscribeUpdateNotice = (listener: () => void): (() => void) => {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  setUpdateNotice(key: string | null): void {
    if (this.noticeKey === key) return
    this.noticeKey = key
    for (const listener of this.noticeListeners) listener()
  }

  /** Clears the missing-event timer without forgetting that this check was manual. */
  noteUpdateCheckEvent(): void {
    this.checkInFlight = false
    if (this.missingEventTimer !== undefined) {
      clearTimeout(this.missingEventTimer)
      this.missingEventTimer = undefined
    }
  }

  private noteSuccessfulUpdateEvent(): void {
    this.noteUpdateCheckEvent()
    this.setUpdateNotice(null)
  }

  markUpdateDownloading(info: UpdateInfo): void {
    this.phase = 'downloading'
    this.latestInfo = info
    this.noteSuccessfulUpdateEvent()
  }

  markUpdateProgress(): void {
    this.phase = 'downloading'
    this.noteSuccessfulUpdateEvent()
  }

  markUpdateDownloaded(info: UpdateInfo): void {
    this.phase = 'downloaded'
    this.latestInfo = info
    this.noteSuccessfulUpdateEvent()
  }

  endManualUpdateCheck(): void {
    this.manualCheckActive = false
    this.phase = 'idle'
    this.noteUpdateCheckEvent()
  }

  /**
   * Drop a downloaded snapshot from the previous channel or test plan.
   * Events carry no channel id. Main retires the old generation only when the
   * preference write finishes, so this session stays inactive until then.
   */
  invalidateSharedUpdateCheck(): number {
    this.session += 1
    this.heldEpoch = this.session
    this.endManualUpdateCheck()
    this.latestInfo = null
    this.setUpdateNotice(null)
    return this.session
  }

  private settleChannelAck(result: ChannelAck): void {
    const waiters = this.channelAckWaiters
    this.channelAckWaiters = []
    for (const waiter of waiters) waiter(result)
  }

  private waitForChannelAck(): Promise<ChannelAck> {
    return new Promise((resolve) => {
      this.channelAckWaiters.push(resolve)
    })
  }

  private releaseHeldEpoch(epoch: number, outcome: ChannelAck): void {
    if (epoch !== this.session || this.heldEpoch !== epoch) return
    this.heldEpoch = null
    this.activeSession = this.session
    if (outcome === 'failed') this.setUpdateNotice('settings.about.updateError')
    this.settleChannelAck(outcome)
  }

  /** Accept events again after the write that runs `cancelDownload` has settled. */
  resumeSharedUpdateSession(epoch: number): void {
    this.releaseHeldEpoch(epoch, 'ready')
  }

  /** Resume this epoch after its preference write rejects, and keep a generic inline error. */
  noteSharedUpdatePreferenceFailure(epoch: number): void {
    this.releaseHeldEpoch(epoch, 'failed')
  }

  resetAppUpdateCheckForTests(): void {
    this.endManualUpdateCheck()
    this.latestInfo = null
    this.session = 0
    this.activeSession = 0
    this.heldEpoch = null
    this.checkOwner = 0
    this.nextCheckOwner = 0
    this.settleChannelAck('failed')
    this.setUpdateNotice(null)
  }

  /** Read the phase at the call, including transitions that happen during an await. */
  private readUpdatePhase(): UpdatePhase {
    return this.phase
  }

  private armMissingEventTimer(update: (patch: UpdatePatch) => void, owner: number, epoch: number): void {
    this.noteUpdateCheckEvent()
    this.checkInFlight = true
    this.missingEventTimer = setTimeout(() => {
      this.missingEventTimer = undefined
      // A newer owner, channel generation, or terminal event owns the slot now.
      if (!this.ownsCheck(owner) || this.session !== epoch || this.phase !== 'checking') return
      this.manualCheckActive = false
      this.checkInFlight = false
      this.phase = 'idle'
      update({ checking: false, downloading: false, downloadProgress: 0, manualCheck: false })
      this.setUpdateNotice('settings.about.updateError')
    }, UPDATE_CHECK_EVENT_WAIT_MS)
  }

  /** Lazy install confirmation for the session captured before the dialog chunk loads. */
  async presentDownloadedUpdate(info: UpdateInfo | null): Promise<void> {
    // A held write already uses the new session number, so epoch equality cannot see it.
    if (!this.isActiveUpdateSession()) return
    const epoch = this.session
    try {
      const { default: UpdateDialogPopup } = await import('@renderer/components/UpdateDialogPopup')
      // An acknowledged channel switch is a new active session, so activity alone is not enough.
      if (this.session !== epoch) return
      await UpdateDialogPopup.show({ releaseInfo: info })
    } catch (error) {
      if (this.session !== epoch) return
      logger.error('Failed to load UpdateDialogPopup chunk:', error as Error)
      this.setUpdateNotice('settings.about.updateError')
    }
  }

  private async openOfficialReleases(): Promise<void> {
    await openExternalWebsite(OFFICIAL_RELEASES_URL)
  }

  private ownsCheck(owner: number): boolean {
    return this.checkOwner === owner
  }

  /**
   * One shared check for About and the error detail modal.
   * Subwindows only hand the click to the main window, which opens the install dialog.
   * A second click while a check or download is in flight does nothing.
   * This function does not reject: every failure stays on the local notice.
   */
  async runAppUpdateCheck(state: UpdateSnapshot, update: (patch: UpdatePatch) => void): Promise<void> {
    if (
      this.checkInFlight ||
      this.phase === 'checking' ||
      this.phase === 'downloading' ||
      state.checking ||
      state.downloading
    ) {
      return
    }

    if (presentedRouteService.readPresentedWindowSource() !== 'mainWindow') {
      this.checkInFlight = true
      try {
        await ipcApi.request('app.updater.present_check')
      } catch {
        this.setUpdateNotice('settings.about.updateError')
        await this.openOfficialReleases().catch(() => undefined)
      } finally {
        this.checkInFlight = false
      }
      return
    }

    // Take the guard before the first await. Two clicks must not both pass get_info.
    const owner = ++this.nextCheckOwner
    this.checkOwner = owner
    let epoch = this.session
    // Queued same-key writes ack one at a time. Check only the last acknowledged channel.
    const deferredUntilChannelAck = this.heldEpoch !== null
    this.checkInFlight = true
    try {
      if (deferredUntilChannelAck) {
        while (this.heldEpoch !== null) {
          const outcome = await this.waitForChannelAck()
          if (outcome === 'failed' || !this.ownsCheck(owner)) return
        }
        // Invalidate clears checkInFlight, so a later click can wait too.
        // Only the latest owner checks the acknowledged channel.
        if (!this.ownsCheck(owner)) return
        this.checkInFlight = true
        epoch = this.session
      }

      // `state.downloaded` can still describe the artifact cleared for the channel write.
      if (this.phase === 'downloaded' || (!deferredUntilChannelAck && state.downloaded)) {
        await this.presentDownloadedUpdate(this.latestInfo ?? state.info)
        return
      }

      try {
        const info = await ipcApi.request('app.get_info')
        if (this.session !== epoch || !this.ownsCheck(owner)) return
        if (info.isPortable) {
          await this.openOfficialReleases().catch(() => this.setUpdateNotice('settings.about.updateError'))
          return
        }
      } catch {
        if (this.session !== epoch || !this.ownsCheck(owner)) return
        this.setUpdateNotice('settings.about.updateError')
        await this.openOfficialReleases().catch(() => undefined)
        return
      }

      if (this.session !== epoch || !this.ownsCheck(owner)) return
      this.activeSession = this.session
      this.manualCheckActive = true
      this.phase = 'checking'
      this.setUpdateNotice(null)
      update({ checking: true, manualCheck: true })
      try {
        await ipcApi.request('app.updater.check_for_update')
        // The check IPC can outlive the watchdog. Arm only after it settles with no updater event.
        if (this.session !== epoch || !this.ownsCheck(owner) || this.phase !== 'checking') return
        this.armMissingEventTimer(update, owner, epoch)
      } catch {
        if (this.session !== epoch || !this.ownsCheck(owner)) return
        this.endManualUpdateCheck()
        update({ checking: false, downloading: false, downloadProgress: 0, manualCheck: false })
        this.setUpdateNotice('settings.about.updateError')
        await this.openOfficialReleases().catch(() => undefined)
      }
    } catch {
      if (this.session !== epoch || !this.ownsCheck(owner)) return
      this.endManualUpdateCheck()
      update({ checking: false, downloading: false, downloadProgress: 0, manualCheck: false })
      this.setUpdateNotice('settings.about.updateError')
    } finally {
      if (this.ownsCheck(owner)) {
        const currentPhase = this.readUpdatePhase()
        if (currentPhase !== 'checking' && currentPhase !== 'downloading') this.checkInFlight = false
      }
    }
  }
}

export const appUpdateCheckService = new AppUpdateCheckService()
