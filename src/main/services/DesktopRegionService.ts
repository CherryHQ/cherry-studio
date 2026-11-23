import { setTimeout as delay } from 'node:timers/promises'

import { eq } from 'drizzle-orm'
import { app, net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  cherryAccountCredentialStore,
  getAccountEdition
} from '@main/services/cherryCloud/CherryAccountCredentialStore'
import {
  getAppEdition,
  getPackageEdition,
  isLegacySessionCompatibilityPackage,
  setRuntimeAppEdition,
  usesRuntimeAppEdition
} from '@main/utils/appEdition'
import { APP_EDITIONS, type AppEdition } from '@shared/types/appEdition'

const logger = loggerService.withContext('DesktopRegionService')
const STATE_KEY = 'app:region'
const LEGACY_SESSION_KEY = 'desktopRegion:legacySession'
const LEGACY_STATE_KEYS = ['desktop:region', 'desktop.region']
const RESPONSE_LIMIT = 32 * 1024
const TIMEOUT = 2_000
const MAINLAND_TIME_ZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Harbin',
  'Asia/Kashgar',
  'Asia/Urumqi',
  'PRC'
])
const PLATFORMS = { win32: 'windows', darwin: 'macos', linux: 'linux' } as const
const decisionSchema = z.object({ region: z.enum(APP_EDITIONS), source: z.enum(['local', 'server', 'account']) })
const legacySessionSchema = z.object({ sessionId: z.string().min(1), region: z.enum(APP_EDITIONS) })
const resolveSchema = z.object({ region: z.enum(['CN', 'GLOBAL']) })
type RegionDecision = z.infer<typeof decisionSchema>

export function inferDesktopEdition(timeZone: string, country: string, locale?: string): AppEdition {
  if (MAINLAND_TIME_ZONES.has(timeZone)) return 'cn'
  if (country) return country.toUpperCase() === 'CN' ? 'cn' : 'global'
  try {
    return locale && new Intl.Locale(locale).region === 'CN' ? 'cn' : 'global'
  } catch {
    return 'global'
  }
}

@Injectable('DesktopRegionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProxyService'])
export class DesktopRegionService extends BaseService {
  protected async onInit(): Promise<void> {
    if (!usesRuntimeAppEdition()) return
    const controller = new AbortController()
    this.registerDisposable(() => controller.abort())

    const session = cherryAccountCredentialStore.get()?.session
    const accountEdition = getAccountEdition(session?.apiOrigin)
    if (accountEdition) {
      setRuntimeAppEdition(accountEdition)
      return
    }
    if (session && !session.apiOrigin) {
      const legacyEdition = isLegacySessionCompatibilityPackage()
        ? this.recordLegacySessionEdition(session.sessionId)
        : this.getLegacySessionEdition(session.sessionId)
      if (legacyEdition) {
        setRuntimeAppEdition(legacyEdition)
        return
      }
    }

    const stored = this.read()
    if (stored && stored.source !== 'local') {
      setRuntimeAppEdition(stored.region)
      return
    }

    const resolved = await this.resolve(undefined, controller.signal)
    if (controller.signal.aborted) return
    if (resolved) this.write({ region: resolved, source: 'server' })
    if (stored) {
      setRuntimeAppEdition(stored.region)
      return
    }
    const region =
      resolved ??
      inferDesktopEdition(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        app.getLocaleCountryCode(),
        app.getPreferredSystemLanguages()[0]
      )
    if (!resolved) this.write({ region, source: 'local' })
    setRuntimeAppEdition(region)
  }

  async confirmLogin(signal: AbortSignal): Promise<AppEdition | null> {
    const stored = this.read()
    const selected = stored && stored.source !== 'local' ? stored.region : undefined
    const region = await this.resolve(selected, signal)
    if (!region || (selected && selected !== region)) return null
    if (!selected) this.write({ region, source: 'server' })
    return region
  }

  rememberAccount(edition: AppEdition): void {
    if (getAppEdition() !== edition) {
      setRuntimeAppEdition(edition)
      application.get('IpcApiService').broadcast('app.edition_changed', edition)
    }
    this.write({ region: edition, source: 'account' })
  }

  getLegacySessionEdition(sessionId: string): AppEdition | undefined {
    try {
      const row = application
        .get('DbService')
        .getDb()
        .select({ value: appStateTable.value })
        .from(appStateTable)
        .where(eq(appStateTable.key, LEGACY_SESSION_KEY))
        .get()
      const legacy = legacySessionSchema.safeParse(row?.value).data
      return legacy?.sessionId === sessionId ? legacy.region : undefined
    } catch (error) {
      logger.warn('Failed to read legacy session region', { error })
      return undefined
    }
  }

  private recordLegacySessionEdition(sessionId: string): AppEdition {
    const region = getPackageEdition()
    try {
      this.write({ region, sessionId }, LEGACY_SESSION_KEY)
    } catch (error) {
      logger.warn('Failed to save legacy session region', { error })
    }
    return region
  }

  private read(): RegionDecision | undefined {
    const db = application.get('DbService').getDb()
    const state = db.select({ value: appStateTable.value }).from(appStateTable)
    const row = state.where(eq(appStateTable.key, STATE_KEY)).get()
    if (row) return decisionSchema.safeParse(row.value).data

    for (const key of LEGACY_STATE_KEYS) {
      const legacy = state.where(eq(appStateTable.key, key)).get()
      const decision = decisionSchema.safeParse(legacy?.value).data
      if (!decision) continue
      db.update(appStateTable).set({ key: STATE_KEY }).where(eq(appStateTable.key, key)).run()
      return decision
    }
    return undefined
  }

  private write(value: RegionDecision | z.infer<typeof legacySessionSchema>, key = STATE_KEY): void {
    application
      .get('DbService')
      .getDb()
      .insert(appStateTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: appStateTable.key, set: { value } })
      .run()
  }

  private async resolve(selected: AppEdition | undefined, signal: AbortSignal): Promise<AppEdition | null> {
    const platform = PLATFORMS[process.platform as keyof typeof PLATFORMS]
    if (!platform) return null
    const wait = new AbortController()
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const proxy = await Promise.race([
        application.get('ProxyService').getAppliedSnapshot(),
        delay(TIMEOUT, null, { signal: AbortSignal.any([wait.signal, deadline]), ref: false })
      ])
      if (!proxy?.converged) return null
      deadline.throwIfAborted()
      const response = await net.fetch('https://config.cherry-ai.com/v1/region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: 'community_desktop',
          platform,
          app_version: app.getVersion(),
          ...(selected && { selected_region: selected.toUpperCase() })
        }),
        credentials: 'omit',
        redirect: 'error',
        signal: deadline
      })
      if (response.status !== 200 || !response.body) return null
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let size = 0
      let body = ''
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > RESPONSE_LIMIT) return null
        body += decoder.decode(next.value, { stream: true })
      }
      const parsed = resolveSchema.safeParse(JSON.parse(body + decoder.decode()))
      return parsed.success ? (parsed.data.region === 'CN' ? 'cn' : 'global') : null
    } catch (error) {
      if (!signal.aborted)
        logger.warn('Desktop region resolution failed', { reason: error instanceof Error ? error.name : 'unknown' })
      return null
    } finally {
      wait.abort()
      void reader?.cancel().catch(() => {})
    }
  }
}
