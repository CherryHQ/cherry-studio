import { setTimeout as delay } from 'node:timers/promises'

import { app, net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  type CherryAccountCredentials,
  cherryAccountCredentialStore,
  getAccountEdition
} from '@main/services/cherryCloud/CherryAccountCredentialStore'
import { getAppEdition, setRuntimeAppEdition, usesRuntimeAppEdition } from '@main/utils/appEdition'
import type { AppEdition } from '@shared/types/appEdition'

const logger = loggerService.withContext('DesktopRegionService')
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
const resolveSchema = z.object({
  schema_version: z.literal(1),
  requires_region_selection: z.literal(false),
  region: z.enum(['CN', 'GLOBAL'])
})

export function inferDesktopEdition(timeZone: string, country: string, locale?: string): AppEdition {
  if (MAINLAND_TIME_ZONES.has(timeZone)) return 'cn'
  if (country) return country.toUpperCase() === 'CN' ? 'cn' : 'global'
  try {
    return locale && new Intl.Locale(locale).region === 'CN' ? 'cn' : 'global'
  } catch {
    return 'global'
  }
}

function getSystemEdition(): AppEdition {
  return inferDesktopEdition(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    app.getLocaleCountryCode(),
    app.getPreferredSystemLanguages()[0]
  )
}

@Injectable('DesktopRegionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProxyService'])
export class DesktopRegionService extends BaseService {
  private startupCredentials: CherryAccountCredentials | null | undefined

  protected onInit(): void {
    if (!usesRuntimeAppEdition()) return

    this.startupCredentials = cherryAccountCredentialStore.get()
    this.registerDisposable(() => {
      this.startupCredentials = undefined
    })
    const session = this.startupCredentials?.session
    const accountEdition =
      session && session.sessionExpiresAt > Date.now() ? getAccountEdition(session.apiOrigin) : undefined
    setRuntimeAppEdition(accountEdition ?? getSystemEdition())
  }

  takeStartupCredentials(): CherryAccountCredentials | null {
    const stored = this.startupCredentials
    this.startupCredentials = undefined
    return stored === undefined ? cherryAccountCredentialStore.get() : stored
  }

  async resolveLoginEdition(signal: AbortSignal): Promise<AppEdition> {
    const edition = await this.resolve(signal)
    signal.throwIfAborted()
    const loginEdition = edition ?? getSystemEdition()
    this.setEdition(loginEdition)
    return loginEdition
  }

  setEdition(edition: AppEdition): void {
    if (getAppEdition() === edition) return
    setRuntimeAppEdition(edition)
    application.get('IpcApiService').broadcast('app.edition_changed', edition)
  }

  resetToSystemEdition(): void {
    this.setEdition(getSystemEdition())
  }

  private async resolve(signal: AbortSignal): Promise<AppEdition | null> {
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
      const response = await net.fetch('https://config.cherry-ai.com/v1/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: 'community_desktop',
          platform,
          app_version: app.getVersion()
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
