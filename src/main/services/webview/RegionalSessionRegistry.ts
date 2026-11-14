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

/** Owns persistent session registrations and revocable host preparation leases. */
export class RegionalSessionRegistry {
  readonly sessions = new Map<Electron.Session, RegionalSession>()
  private readonly leases = new Map<string, RegionalLease>()
  private readonly hosts = new Map<Electron.WebContents, () => void>()
  private readonly retirements = new Map<string, Promise<void>>()
  private readonly clearingApps = new Set<string>()
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
    const country = this.country(appId)
    if (!country) return { partition: 'persist:webview', fake: false, leaseId: null }
    if (!isMiniAppRegionEligible(this.requireSite(appId))) {
      await Promise.all(
        [...this.leases].filter(([, lease]) => lease.appId === appId).map(([id]) => this.releaseLease(id))
      )
      if (host.isDestroyed() || this.cleanupBlockedApps.has(appId) || this.suspended) {
        throw new Error('Regional preparation was revoked')
      }
      return { partition: 'persist:webview', fake: false, leaseId: null }
    }
    const partition = getMiniAppRegionPartition(appId, country)
    await this.retirements.get(partition)
    if (host.isDestroyed() || this.cleanupBlockedApps.has(appId) || this.country(appId) !== country || this.suspended) {
      throw new Error('Regional preparation was revoked')
    }
    this.requireRegionalSite(appId)
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
    if (this.suspended || src !== 'about:blank' || this.retirements.has(partition ?? '')) return false
    for (const lease of this.leases.values()) {
      if (
        lease.ready &&
        this.sessions.has(lease.guestSession) &&
        lease.partition === partition &&
        lease.host.id === hostId &&
        !lease.host.isDestroyed() &&
        !this.cleanupBlockedApps.has(lease.appId) &&
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
    await Promise.all([...this.leases].filter(([, lease]) => lease.host === host).map(([id]) => this.releaseLease(id)))
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
    if (![...this.leases.values()].some((other) => other.guestSession === lease.guestSession)) {
      await this.retire(lease.guestSession, lease.partition)
    } else if (
      ![...this.leases.values()].some((other) => other.guestSession === lease.guestSession && other.host === lease.host)
    ) {
      try {
        await this.closeGuests(lease.guestSession, lease.host)
      } catch (error) {
        await this.retire(lease.guestSession, lease.partition)
        throw error
      }
    }
  }

  private retire(guestSession: Electron.Session, partition: string): Promise<void> {
    const existing = this.retirements.get(partition)
    if (existing) return existing
    const regional = this.sessions.get(guestSession)
    const remaining = [...this.leases].filter(([, lease]) => lease.guestSession === guestSession)
    for (const [id] of remaining) this.forgetLease(id)
    this.sessions.delete(guestSession)
    regional?.cleanup()
    const unregister = application.get('ProxyService').unregisterSession(guestSession)
    const closing = this.closeGuests(guestSession)
    const task = Promise.all([regional?.ready.catch(() => {}), unregister, closing]).then(() => {
      if (remaining.length && regional) {
        application.get('IpcApiService').broadcast('webview.region.invalidated', { appId: regional.appId })
      }
    })
    this.retirements.set(partition, task)
    void task
      .then(() => {
        if (this.retirements.get(partition) === task) this.retirements.delete(partition)
      })
      .catch(() => {})
    return task
  }

  private async closeGuests(guestSession: Electron.Session, host?: Electron.WebContents): Promise<void> {
    await Promise.all(
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
        )
    )
  }

  async revokeInactive(): Promise<void> {
    await Promise.all(
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
        .map(([id]) => this.releaseLease(id))
    )
  }

  async clearData(appId: string, senderId: WindowId | null): Promise<void> {
    this.requireHost(senderId)
    this.requireSite(appId)
    await this.withDataCleared(appId, () => {})
  }

  async removeApp(appId: string): Promise<void> {
    const app = this.requireSite(appId)
    if (app.presetMiniAppId !== null) {
      miniAppService.delete(appId)
      return
    }
    await this.withDataCleared(appId, async () => {
      miniAppService.delete(appId)
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
      })
      this.selectionQueue = write.catch(() => {})
      await write
    })
  }

  private async withDataCleared(appId: string, action: () => void | Promise<void>): Promise<void> {
    if (this.clearingApps.has(appId)) throw new Error('Regional data cleanup is already running')
    this.clearingApps.add(appId)
    this.cleanupBlockedApps.add(appId)
    try {
      await Promise.allSettled(
        [...this.leases].filter(([, lease]) => lease.appId === appId).map(([id]) => this.releaseLease(id))
      )
      for (const country of Object.keys(MINI_APP_REGIONS) as MiniAppCountry[]) {
        const partition = getMiniAppRegionPartition(appId, country)
        await this.retirements.get(partition)?.catch(() => {})
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
    } finally {
      this.clearingApps.delete(appId)
    }
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
    await Promise.all(
      [...this.sessions].map(async ([guestSession, regional]) => {
        regional.cleanup()
        await application.get('ProxyService').unregisterSession(guestSession)
      })
    )
    await Promise.all(this.retirements.values())
  }

  async dispose(): Promise<void> {
    this.suspended = true
    await Promise.all([...this.leases.keys()].map((id) => this.releaseLease(id)))
    await Promise.all(this.retirements.values())
  }
}
