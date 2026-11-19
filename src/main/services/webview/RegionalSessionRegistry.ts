import { randomUUID } from 'node:crypto'

import { session, webContents } from 'electron'

import { application } from '@application'
import { miniAppService } from '@data/services/MiniAppService'
import { loggerService } from '@logger'
import type { WindowId } from '@shared/ipc/types'
import { MINI_APP_REGIONS, type MiniAppCountry, type MiniAppRegionProfile } from '@shared/types/miniAppRegion'
import { getMiniAppRegionPartition, isMiniAppRegionEligible, selectedMiniAppCountry } from '@shared/utils/miniAppRegion'

const logger = loggerService.withContext('RegionalSessionRegistry')

interface RegionalSession {
  appId: string
  country: MiniAppCountry
  profile: MiniAppRegionProfile
  ready: Promise<void>
  cleanup: () => void
}

interface RegionalLease {
  ready: boolean
  host: Electron.WebContents
  guestSession: Electron.Session
  partition: string
  appId: string
  country: MiniAppCountry
}

interface RegionalRetirement {
  appId: string
  done: Promise<void>
}

class RegionalCleanupError extends AggregateError {}

function throwCleanupErrors(outcomes: PromiseSettledResult<unknown>[], message: string): void {
  const errors = new Set<unknown>()
  for (const outcome of outcomes) {
    if (outcome.status !== 'rejected') continue
    const reason: unknown = outcome.reason
    if (reason instanceof RegionalCleanupError) {
      for (const error of reason.errors) errors.add(error)
    } else {
      errors.add(reason)
    }
  }
  if (errors.size === 1) throw errors.values().next().value
  if (errors.size > 1) throw new RegionalCleanupError(errors, message)
}

async function drainCleanup(tasks: Iterable<Promise<unknown>>, message: string): Promise<void> {
  throwCleanupErrors(await Promise.allSettled(tasks), message)
}

/** Owns persistent session registrations and revocable host preparation leases. */
export class RegionalSessionRegistry {
  readonly sessions = new Map<Electron.Session, RegionalSession>()
  private readonly leases = new Map<string, RegionalLease>()
  private readonly hosts = new Map<Electron.WebContents, () => void>()
  private readonly retirements = new Map<string, RegionalRetirement>()
  private readonly hostCleanups = new Map<Promise<void>, string>()
  private readonly dataCleanups = new Map<string, Promise<void>>()
  private readonly stopDrains = new Set<Set<Promise<void>>>()
  private readonly cleanupBlockedApps = new Set<string>()
  private readonly guests = new Map<Electron.WebContents, { host?: Electron.WebContents; cleanup: () => void }>()
  private suspended = false
  private selectionQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly initializeSession: (guestSession: Electron.Session, profile: MiniAppRegionProfile) => () => void
  ) {}

  private requireHost(senderId: WindowId | null): Electron.WebContents {
    const host = senderId ? application.get('WindowManager').getWindow(senderId)?.webContents : undefined
    if (!host || host.isDestroyed()) throw new Error('A managed host window is required')
    return host
  }

  private requireSite(appId: string) {
    const app = miniAppService.getByAppId(appId)
    if (app.kind !== 'site') throw new Error('A website MiniApp is required')
    return app
  }

  private requireRegionalSite(appId: string) {
    const app = this.requireSite(appId)
    if (!isMiniAppRegionEligible(app)) {
      throw new Error('Regional sessions require an HTTP(S) website MiniApp')
    }
    return app
  }

  private country(appId: string): MiniAppCountry | null {
    const preferences = application.get('PreferenceService')
    if (!preferences.get('app.developer_mode.enabled') || !preferences.get('feature.mini_app.fake_environment.enabled'))
      return null
    return selectedMiniAppCountry(
      appId,
      preferences.get('feature.mini_app.region_profiles'),
      preferences.get('feature.mini_app.us_environment_app_ids'),
      preferences.get('feature.mini_app.fake_environment.country')
    )
  }

  private appRetirements(appId: string): RegionalRetirement[] {
    return [...this.retirements.values()].filter((retirement) => retirement.appId === appId)
  }

  setCountry(appId: string, country: MiniAppCountry | null, senderId: WindowId | null): Promise<void> {
    const write = this.selectionQueue.then(async () => {
      this.requireHost(senderId)
      if (country) this.requireRegionalSite(appId)
      else this.requireSite(appId)
      if ((country && this.cleanupBlockedApps.has(appId)) || this.suspended)
        throw new Error('Regional session is unavailable')
      const preferences = application.get('PreferenceService')
      if (
        country &&
        (!preferences.get('app.developer_mode.enabled') ||
          !preferences.get('feature.mini_app.fake_environment.enabled'))
      )
        throw new Error('Regional profiles are disabled')
      await preferences.set('feature.mini_app.region_profiles', {
        ...preferences.get('feature.mini_app.region_profiles'),
        [appId]: country
      })
      await this.revokeInactive()
    })
    this.selectionQueue = write.catch(() => {})
    return write
  }

  async prepare(appId: string, senderId: WindowId | null) {
    const host = this.requireHost(senderId)
    if (this.suspended || this.cleanupBlockedApps.has(appId)) throw new Error('Regional session is unavailable')
    let pending = this.appRetirements(appId)
    while (pending.length) {
      await drainCleanup(
        pending.map(({ done }) => done),
        'Failed to retire regional sessions for this MiniApp'
      )
      pending = this.appRetirements(appId)
    }
    if (host.isDestroyed() || this.cleanupBlockedApps.has(appId) || this.suspended) {
      throw new Error('Regional preparation was revoked')
    }
    const country = this.country(appId)
    if (!country) return { partition: 'persist:webview', fake: false, leaseId: null }
    if (!isMiniAppRegionEligible(this.requireSite(appId))) {
      await drainCleanup(
        [...this.leases].filter(([, lease]) => lease.appId === appId).map(([id]) => this.releaseLease(id)),
        'Failed to retire regional sessions for this MiniApp'
      )
      if (host.isDestroyed() || this.cleanupBlockedApps.has(appId) || this.suspended) {
        throw new Error('Regional preparation was revoked')
      }
      return { partition: 'persist:webview', fake: false, leaseId: null }
    }
    const partition = getMiniAppRegionPartition(appId, country)
    const guestSession = session.fromPartition(partition)
    let regional = this.sessions.get(guestSession)
    if (!regional) {
      const profile = MINI_APP_REGIONS[country]
      regional = {
        appId,
        country,
        profile,
        cleanup: this.initializeSession(guestSession, profile),
        ready: application.get('ProxyService').registerSession(guestSession)
      }
      this.sessions.set(guestSession, regional)
    }
    const leaseId = randomUUID()
    this.leases.set(leaseId, { host, guestSession, partition, appId, country, ready: false })
    if (!this.hosts.has(host)) {
      const cleanup = () => {
        void this.releaseHost(host).catch((error) => logger.warn('Regional host cleanup failed', error))
      }
      host.once('destroyed', cleanup)
      this.hosts.set(host, cleanup)
    }
    try {
      await regional.ready
      const lease = this.leases.get(leaseId)
      if (lease) lease.ready = true
      if (!lease || !this.isPrepared(partition, host.id)) {
        throw new Error('Regional preparation was revoked')
      }
      return { partition, fake: true, leaseId }
    } catch (error) {
      await this.releaseLease(leaseId)
      throw error
    }
  }

  isPrepared(partition: string | undefined, hostId: number | undefined, src = 'about:blank'): boolean {
    if (this.suspended || src !== 'about:blank') return false
    for (const lease of this.leases.values()) {
      if (
        lease.ready &&
        this.sessions.has(lease.guestSession) &&
        lease.partition === partition &&
        lease.host.id === hostId &&
        !lease.host.isDestroyed() &&
        !this.cleanupBlockedApps.has(lease.appId) &&
        this.appRetirements(lease.appId).length === 0 &&
        this.country(lease.appId) === lease.country
      ) {
        try {
          this.requireRegionalSite(lease.appId)
          return true
        } catch {
          return false
        }
      }
    }
    return false
  }

  async release(leaseId: string, senderId: WindowId | null): Promise<void> {
    const lease = this.leases.get(leaseId)
    if (!lease) return
    if (lease.host !== this.requireHost(senderId)) throw new Error('The caller does not own this regional lease')
    await this.releaseLease(leaseId)
  }

  trackGuest(guest: Electron.WebContents, inheritedHost?: Electron.WebContents): void {
    if (!this.sessions.has(guest.session) || guest.isDestroyed()) return
    const existing = this.guests.get(guest)
    if (existing) {
      if (inheritedHost) existing.host = inheritedHost
      return
    }
    const binding = { host: inheritedHost ?? guest.hostWebContents ?? undefined, cleanup: () => {} }
    const popup = (window: Electron.BrowserWindow) => this.trackGuest(window.webContents, binding.host)
    binding.cleanup = () => {
      guest.removeListener('did-create-window', popup)
      guest.removeListener('destroyed', binding.cleanup)
      this.guests.delete(guest)
    }
    guest.on('did-create-window', popup)
    guest.once('destroyed', binding.cleanup)
    this.guests.set(guest, binding)
  }

  private async releaseHost(host: Electron.WebContents): Promise<void> {
    await drainCleanup(
      [...this.leases].filter(([, lease]) => lease.host === host).map(([id]) => this.releaseLease(id)),
      'Failed to release regional leases for this window'
    )
  }

  private forgetLease(leaseId: string): RegionalLease | undefined {
    const lease = this.leases.get(leaseId)
    if (!lease) return
    this.leases.delete(leaseId)
    if (![...this.leases.values()].some((other) => other.host === lease.host)) {
      const cleanup = this.hosts.get(lease.host)!
      lease.host.removeListener('destroyed', cleanup)
      this.hosts.delete(lease.host)
    }
    return lease
  }

  private async releaseLease(leaseId: string): Promise<void> {
    const lease = this.forgetLease(leaseId)
    if (!lease) return
    const regional = this.sessions.get(lease.guestSession)
    if (!regional) return
    if (![...this.leases.values()].some((other) => other.guestSession === lease.guestSession)) {
      await this.retire(lease, regional)
    } else if (
      ![...this.leases.values()].some((other) => other.guestSession === lease.guestSession && other.host === lease.host)
    ) {
      const cleanup = Promise.resolve().then(() => this.closeHostGuests(lease, regional))
      this.hostCleanups.set(cleanup, lease.appId)
      this.includeInStop(cleanup)
      try {
        await cleanup
      } finally {
        this.hostCleanups.delete(cleanup)
      }
    }
  }

  private async closeHostGuests(lease: RegionalLease, regional: RegionalSession): Promise<void> {
    try {
      await this.closeGuests(lease.guestSession, lease.host)
    } catch (error) {
      await drainCleanup(
        [Promise.reject(error), this.retire(lease, regional)],
        'Failed to close a window’s regional guests'
      )
    }
  }

  private sessionCleanup(guestSession: Electron.Session, regional: RegionalSession): Promise<void>[] {
    return [
      Promise.resolve().then(regional.cleanup),
      Promise.resolve().then(() => application.get('ProxyService').unregisterSession(guestSession)),
      regional.ready.catch(() => {})
    ]
  }

  private retire({ guestSession, partition, appId }: RegionalLease, regional: RegionalSession): Promise<void> {
    const existing = this.retirements.get(partition)
    if (existing) return existing.done
    if (this.sessions.get(guestSession) !== regional) return Promise.resolve()
    const remaining = [...this.leases].filter(([, lease]) => lease.guestSession === guestSession)
    for (const [id] of remaining) this.forgetLease(id)
    this.sessions.delete(guestSession)
    const done = drainCleanup(
      [...this.sessionCleanup(guestSession, regional), Promise.resolve().then(() => this.closeGuests(guestSession))],
      'Failed to retire a regional session'
    ).catch((error) => {
      this.cleanupBlockedApps.add(appId)
      throw error
    })
    const retirement = { appId, done }
    this.retirements.set(partition, retirement)
    this.includeInStop(done)
    void done
      .then(() => {
        if (this.retirements.get(partition) === retirement) this.retirements.delete(partition)
        if (remaining.length) application.get('IpcApiService').broadcast('webview.region.invalidated', { appId })
      })
      .catch((error) => logger.warn('Regional session retirement failed', error))
    return done
  }

  private async closeGuests(guestSession: Electron.Session, host?: Electron.WebContents): Promise<void> {
    await drainCleanup(
      webContents
        .getAllWebContents()
        .filter((guest) => !guest.isDestroyed() && guest.session === guestSession)
        .filter((guest) => !host || guest.hostWebContents === host || this.guests.get(guest)?.host === host)
        .map(
          (guest) =>
            new Promise<void>((resolve, reject) => {
              const closed = () => {
                clearTimeout(timer)
                resolve()
              }
              const timer = setTimeout(() => {
                guest.removeListener('destroyed', closed)
                reject(new Error('Regional guest did not close before data cleanup'))
              }, 5_000)
              guest.once('destroyed', closed)
              try {
                guest.close({ waitForBeforeUnload: false })
              } catch (error) {
                clearTimeout(timer)
                guest.removeListener('destroyed', closed)
                reject(error)
              }
            })
        ),
      'Failed to close regional guests'
    )
  }

  async revokeInactive(): Promise<void> {
    await drainCleanup(
      [...this.leases]
        .filter(([, lease]) => {
          if (this.country(lease.appId) !== lease.country) return true
          try {
            this.requireRegionalSite(lease.appId)
            return false
          } catch {
            return true
          }
        })
        .map(([id]) => this.releaseLease(id)),
      'Failed to revoke inactive regional leases'
    )
  }

  async clearData(appId: string, senderId: WindowId | null): Promise<void> {
    this.requireHost(senderId)
    this.requireSite(appId)
    await this.withDataCleared(appId, () => {})
  }

  async removeApp(appId: string, senderId: WindowId | null): Promise<void> {
    this.requireHost(senderId)
    const app = this.requireSite(appId)
    if (app.presetMiniAppId !== null) {
      miniAppService.delete(appId)
      return
    }
    await this.withDataCleared(appId, async () => {
      const write = this.selectionQueue.then(async () => {
        const preferences = application.get('PreferenceService')
        const profiles = { ...preferences.get('feature.mini_app.region_profiles') }
        delete profiles[appId]
        await preferences.setMultiple({
          'feature.mini_app.region_profiles': profiles,
          'feature.mini_app.us_environment_app_ids': preferences
            .get('feature.mini_app.us_environment_app_ids')
            .filter((id) => id !== appId)
        })
        miniAppService.delete(appId)
      })
      this.selectionQueue = write.catch(() => {})
      await write
    })
  }

  private async withDataCleared(appId: string, action: () => void | Promise<void>): Promise<void> {
    if (this.dataCleanups.has(appId)) throw new Error('Regional data cleanup is already running')
    this.cleanupBlockedApps.add(appId)
    const cleanup = Promise.resolve().then(() => this.clearDataAndRun(appId, action))
    this.dataCleanups.set(appId, cleanup)
    this.includeInStop(cleanup)
    try {
      await cleanup
    } finally {
      this.dataCleanups.delete(appId)
    }
  }

  private async clearDataAndRun(appId: string, action: () => void | Promise<void>): Promise<void> {
    await Promise.allSettled([
      ...[...this.leases].filter(([, lease]) => lease.appId === appId).map(([id]) => this.releaseLease(id)),
      ...[...this.hostCleanups].filter(([, ownerAppId]) => ownerAppId === appId).map(([task]) => task)
    ])
    for (const country of Object.keys(MINI_APP_REGIONS) as MiniAppCountry[]) {
      const partition = getMiniAppRegionPartition(appId, country)
      await this.retirements.get(partition)?.done.catch(() => {})
      const guestSession = session.fromPartition(partition)
      guestSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
      await this.closeGuests(guestSession)
      await guestSession.closeAllConnections()
      await guestSession.clearStorageData()
      await guestSession.clearCache()
      await guestSession.clearCodeCaches({ urls: [] })
      this.retirements.delete(partition)
    }
    await action()
    this.cleanupBlockedApps.delete(appId)
    application.get('IpcApiService').broadcast('webview.region.invalidated', { appId })
  }

  async resume(): Promise<void> {
    const preferences = application.get('PreferenceService')
    const legacy = preferences.get('feature.mini_app.us_environment_app_ids')
    if (legacy.length) {
      const profiles = { ...preferences.get('feature.mini_app.region_profiles') }
      for (const appId of legacy) {
        if (!Object.hasOwn(profiles, appId))
          profiles[appId] = preferences.get('feature.mini_app.fake_environment.country')
      }
      await preferences.setMultiple({
        'feature.mini_app.region_profiles': profiles,
        'feature.mini_app.us_environment_app_ids': []
      })
    }
    if (this.suspended) {
      for (const [guestSession, regional] of this.sessions) {
        regional.cleanup = this.initializeSession(guestSession, regional.profile)
        regional.ready = application.get('ProxyService').registerSession(guestSession)
      }
      await Promise.all([...this.sessions.values()].map((regional) => regional.ready))
    }
    this.suspended = false
    await this.revokeInactive()
  }

  async suspend(): Promise<void> {
    this.suspended = true
    await this.drainBeforeStop(
      [...this.sessions].flatMap(([guestSession, regional]) => this.sessionCleanup(guestSession, regional)),
      'Failed to suspend regional sessions'
    )
  }

  async dispose(): Promise<void> {
    this.suspended = true
    await this.drainBeforeStop(
      [...this.leases.keys()].map((id) => this.releaseLease(id)),
      'Failed to dispose regional sessions'
    )
  }

  private includeInStop(task: Promise<void>): void {
    for (const pending of this.stopDrains) pending.add(task)
  }

  private async drainBeforeStop(tasks: Promise<void>[], message: string): Promise<void> {
    const pending = new Set([
      ...tasks,
      ...this.hostCleanups.keys(),
      ...this.dataCleanups.values(),
      ...[...this.retirements.values()].map(({ done }) => done)
    ])
    const outcomes: PromiseSettledResult<void>[] = []
    // Keep jobs started during stop even if they finish before the next batch.
    this.stopDrains.add(pending)
    try {
      while (pending.size) {
        const batch = [...pending]
        pending.clear()
        outcomes.push(...(await Promise.allSettled(batch)))
      }
      throwCleanupErrors(outcomes, message)
    } finally {
      this.stopDrains.delete(pending)
    }
  }
}
