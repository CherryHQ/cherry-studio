import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { FiltersEngine, Request } from '@ghostery/adblocker'
import { app, ipcMain, session, webContents } from 'electron'
import { parse as parseHostname } from 'tldts-experimental'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { SequencerByKey } from '@shared/utils/async'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import {
  type CustomAdblockRule,
  CustomAdblockRuleStore,
  hostnameMatchesDomain,
  type NewCustomAdblockRule,
  splitSelectors
} from './customRules'
import { setAdblockGate } from './gate'
import { getSearchAdsCss } from './searchAds'

const logger = loggerService.withContext('AdblockService')

const PREF = {
  enabled: 'app.browser.adblock.enabled',
  searchAds: 'app.browser.adblock.search_ads',
  aiRules: 'app.browser.adblock.ai_rules'
} as const

const RESOURCE_DIR = 'adblock'
const PRELOAD_FILE = 'preload.cjs'
const ENGINE_FILE = 'engine.bin'

/** Channels the bundled `@ghostery/adblocker-electron-preload` talks to. */
const INJECT_COSMETIC_FILTERS = '@ghostery/adblocker/inject-cosmetic-filters'
const IS_MUTATION_OBSERVER_ENABLED = '@ghostery/adblocker/is-mutation-observer-enabled'

/** Payload the preload sends after it has scanned the DOM. */
interface CosmeticFilterUpdate {
  classes?: string[]
  hrefs?: string[]
  ids?: string[]
  lifecycle?: string
}

/**
 * Partitions of the standalone `@cherry/browser` MCP server, mirroring
 * `SESSION_KEY_DEFAULT` / `SESSION_KEY_PRIVATE` in the browser feature. Its tabs
 * are not created by the app's webview registry, so they are covered here
 * directly: nothing else owns the request slot of these sessions.
 */
const STANDALONE_BROWSER_PARTITIONS = ['persist:default', 'private'] as const

/**
 * Page that issued a request. `referrer` is empty under
 * `Referrer-Policy: no-referrer`, so the initiator origin or frame URL stands in.
 */
function requestSource(details: Electron.OnBeforeRequestListenerDetails): string | undefined {
  if (details.referrer) return details.referrer
  const origin = details.initiatorOrigin
  if (origin) return origin === 'null' ? undefined : `${origin}/`
  try {
    return details.frame?.url || undefined
  } catch {
    return undefined
  }
}

/** `a.b.example.com` → itself and every parent, so a rule saved for `example.com` still applies. */
function domainCandidates(hostname: string): string[] {
  const labels = hostname.split('.')
  return labels.map((_, index) => labels.slice(index).join('.'))
}

/**
 * Ad blocking for the built-in browser.
 *
 * Two layers, each with its own switch:
 *
 * - Network: a serialized EasyList/EasyList China/EasyPrivacy engine answers
 *   `match()` for every browser request. Electron allows one listener per
 *   `webRequest` event, so this service never registers a second one on a
 *   session that owns its policy; those sessions consult {@link gate} instead.
 * - Cosmetic: the engine's selectors are injected by the library's preload,
 *   registered per session. The search-result rules and the rules the AI writes
 *   through the browser tool are a separate stylesheet, so each can be updated
 *   or removed without rebuilding the engine.
 *
 * AI-written network rules live in one small `FiltersEngine` per saved domain:
 * dropping a rule only re-parses that domain's short list, not the 98k bundle,
 * and the engine consulted for a request is itself the scope boundary.
 */
@Injectable('AdblockService')
@ServicePhase(Phase.WhenReady)
export class AdblockService extends BaseService {
  private engine?: FiltersEngine
  /**
   * One engine per saved domain. Scope comes from which engine is consulted for
   * a request's source, never from text appended to the filter, so a rule can
   * not escape its domain no matter what its option tail looks like.
   */
  private customEngines = new Map<string, FiltersEngine>()
  private readonly rules = new CustomAdblockRuleStore(application.getPath('feature.adblock.rules_file'))
  private enabled = false
  private hideSearchAds = false
  private blockedRequests = 0
  private ipcRegistered = false
  private readonly cosmeticScripts = new Map<Electron.Session, string>()
  private readonly ownedRequestSessions = new Set<Electron.Session>()
  private readonly searchAdsGuests = new WeakSet<Electron.WebContents>()
  private readonly injectedCss = new Map<number, string>()
  private readonly cssInjections = new SequencerByKey<number>()
  private readonly unsubscribers: Array<() => void> = []

  protected async onInit(): Promise<void> {
    const preferences = application.get('PreferenceService')
    this.enabled = preferences.get(PREF.enabled)
    this.hideSearchAds = preferences.get(PREF.searchAds)

    await Promise.all([this.loadEngine(), this.rules.load()])
    this.rebuildCustomEngines()
    logger.info('Custom adblock rules loaded', {
      count: this.rules.list().length,
      enabled: this.rules.list().filter((rule) => rule.enabled).length
    })
    this.registerCosmeticIpc()
    this.syncCosmeticPreloads()
    this.bridgeRequestSessions()
    setAdblockGate(this.shouldBlock)

    this.watchGuests()
    this.unsubscribers.push(preferences.subscribeMultipleChanges([PREF.enabled, PREF.searchAds], this.applyPreferences))
  }

  protected async onStop(): Promise<void> {
    setAdblockGate(undefined)
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    for (const guestSession of [...this.cosmeticScripts.keys()]) this.disableCosmetic(guestSession)
  }

  /** True when the engine is loaded and the master switch is on. */
  isActive(): boolean {
    return this.enabled && this.engine !== undefined
  }

  /** Number of requests cancelled since start; surfaced in diagnostics only. */
  getBlockedRequestCount(): number {
    return this.blockedRequests
  }

  listCustomRules(): CustomAdblockRule[] {
    return this.rules.list()
  }

  /** Whether the AI may add rules while it browses. Existing rules keep working when this is off. */
  isAiRuleWritingEnabled(): boolean {
    return application.get('PreferenceService').get(PREF.aiRules)
  }

  async addCustomRule(input: NewCustomAdblockRule): Promise<{ rule: CustomAdblockRule; existing: boolean }> {
    const result = await this.rules.add(input)
    this.rebuildCustomEngines()
    this.refreshOpenPages()
    logger.info('Custom adblock rule saved', {
      domain: result.rule.domain,
      kind: result.rule.kind,
      existing: result.existing
    })
    return result
  }

  async removeCustomRule(id: string): Promise<boolean> {
    const removed = await this.rules.remove(id)
    if (removed) {
      this.rebuildCustomEngines()
      this.refreshOpenPages()
    }
    return removed
  }

  async setCustomRuleEnabled(id: string, enabled: boolean): Promise<CustomAdblockRule | undefined> {
    const rule = await this.rules.setEnabled(id, enabled)
    if (rule) {
      this.rebuildCustomEngines()
      this.refreshOpenPages()
    }
    return rule
  }

  /**
   * Answers for one `onBeforeRequest` event. Main-frame requests are never
   * cancelled: that would turn an ad landing page into a blank window instead
   * of a blocked resource.
   */
  private readonly shouldBlock = (details: Electron.OnBeforeRequestListenerDetails): boolean => {
    if (!this.isActive() || details.resourceType === 'mainFrame') return false
    try {
      const source = requestSource(details)
      const request = Request.fromRawDetails({
        requestId: `${details.id}`,
        url: details.url,
        type: details.resourceType,
        sourceUrl: source,
        tabId: details.webContentsId
      })
      if (source && this.matchesCustomRules(request, source)) {
        this.blockedRequests++
        return true
      }
      const { match } = this.engine!.match(request)
      if (match) this.blockedRequests++
      return match
    } catch (error) {
      logger.debug('Adblock match failed', { error, url: details.url })
      return false
    }
  }

  /** True when a rule saved for the request's own domain (or a parent) matches. */
  private matchesCustomRules(request: Request, source: string): boolean {
    if (this.customEngines.size === 0) return false
    let hostname: string
    try {
      hostname = new URL(source).hostname.toLowerCase()
    } catch {
      return false
    }
    if (!hostname) return false
    for (const candidate of domainCandidates(hostname)) {
      const engine = this.customEngines.get(candidate)
      if (engine?.match(request).match) return true
    }
    return false
  }

  private async loadEngine(): Promise<void> {
    const enginePath = path.join(application.getPath('app.root.resources'), RESOURCE_DIR, ENGINE_FILE)
    try {
      const buffer = await readFile(enginePath)
      this.engine = FiltersEngine.deserialize(new Uint8Array(buffer))
      logger.info('Adblock engine loaded', { bytes: buffer.byteLength, path: enginePath })
    } catch (error) {
      // The rest of the browser keeps working; the switch simply has no effect.
      logger.warn(
        `Adblock engine missing at ${enginePath}. Run "node scripts/adblock/build-engine.mjs" to rebuild it.`,
        { error }
      )
    }
  }

  /**
   * Compiles the enabled custom network rules into one small engine per saved
   * domain. Cosmetic rules never enter an engine: they are injected as CSS so a
   * rule can be removed from an open page without a reload.
   */
  private rebuildCustomEngines(): void {
    const byDomain = new Map<string, string[]>()
    for (const rule of this.rules.list()) {
      if (!rule.enabled || rule.kind !== 'network') continue
      const filters = byDomain.get(rule.domain)
      if (filters) filters.push(rule.value)
      else byDomain.set(rule.domain, [rule.value])
    }
    const engines = new Map<string, FiltersEngine>()
    for (const [domain, filters] of byDomain) {
      try {
        engines.set(
          domain,
          FiltersEngine.parse(filters.join('\n'), {
            loadNetworkFilters: true,
            loadCosmeticFilters: false,
            loadExceptionFilters: true,
            loadCSPFilters: false,
            enableMutationObserver: false,
            guessRequestTypeFromUrl: true
          })
        )
      } catch (error) {
        logger.warn('Failed to compile custom adblock rules', { domain, error })
      }
    }
    this.customEngines = engines
  }

  /**
   * Mirrors the injector shipped by `@ghostery/adblocker-electron`, but keeps
   * the Electron adapter in this repo so the module graph never imports the
   * package's Electron entry (which patches globals and reads the binary path).
   */
  private registerCosmeticIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true
    ipcMain.handle(INJECT_COSMETIC_FILTERS, (event, url?: string, message?: CosmeticFilterUpdate) => {
      if (!this.isActive() || !this.engine) return
      const target = url ?? event.sender.getURL()
      // Only web pages get cosmetic filters; local mini-app and file preview
      // documents must not inherit generic ad-hiding selectors.
      if (!/^https?:/i.test(target)) return
      const parsed = parseHostname(target)
      const isFirstRun = message === undefined
      const { active, styles, scripts } = this.engine.getCosmeticsFilters({
        url: target,
        hostname: parsed.hostname ?? '',
        domain: parsed.domain,
        classes: message?.classes,
        hrefs: message?.hrefs,
        ids: message?.ids,
        getBaseRules: isFirstRun,
        getInjectionRules: isFirstRun,
        getExtendedRules: false,
        getRulesFromHostname: isFirstRun,
        getRulesFromDOM: !isFirstRun
      })
      // AI-written cosmetic rules are injected through the tracked page
      // stylesheet (see `injectPageCss`), never here. A second, untracked copy
      // from this preload would survive deleting the rule.
      if (active && styles.length > 0) {
        void event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch((error) => {
          logger.debug('Failed to inject cosmetic filters', { error })
        })
      }
      for (const script of scripts) {
        try {
          event.sender.executeJavaScript(script, true).catch((error) => {
            logger.debug('Adblock scriptlet crashed', { error })
          })
        } catch (error) {
          logger.debug('Adblock scriptlet crashed', { error })
        }
      }
    })
    ipcMain.handle(IS_MUTATION_OBSERVER_ENABLED, () => this.isActive())
    this.registerDisposable(() => {
      ipcMain.removeHandler(INJECT_COSMETIC_FILTERS)
      ipcMain.removeHandler(IS_MUTATION_OBSERVER_ENABLED)
      this.ipcRegistered = false
    })
  }

  private customCssFor(rawUrl: string): string {
    if (!this.isActive()) return ''
    let hostname: string
    try {
      hostname = new URL(rawUrl).hostname
    } catch {
      return ''
    }
    const selectors = this.rules
      .list()
      .filter((rule) => rule.enabled && rule.kind === 'cosmetic' && hostnameMatchesDomain(hostname, rule.domain))
      .flatMap((rule) => splitSelectors(rule.value))
    if (selectors.length === 0) return ''
    // One block per selector: an entry Chromium refuses to parse cannot take
    // the valid rules beside it down with the shared selector list.
    return selectors.map((selector) => `${selector} {\n  display: none !important;\n}`).join('\n')
  }

  /**
   * Installs an owned request listener on the sessions whose request slot is
   * free: the site webview and the standalone MCP browser. The agent browser
   * owns its listener (see {@link gate}) and must not be touched.
   */
  private bridgeRequestSessions(): void {
    const partitions = [getWebviewPartition(WebviewSecurityProfile.MiniApp), ...STANDALONE_BROWSER_PARTITIONS]
    for (const partition of partitions) this.ownRequestSession(session.fromPartition(partition))
  }

  private ownRequestSession(guestSession: Electron.Session): void {
    if (this.ownedRequestSessions.has(guestSession)) return
    this.ownedRequestSessions.add(guestSession)
    guestSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback(this.shouldBlock(details) ? { cancel: true } : {})
    })
    this.registerDisposable(() => {
      guestSession.webRequest.onBeforeRequest(null)
      this.ownedRequestSessions.delete(guestSession)
    })
  }

  private readonly applyPreferences = (): void => {
    const preferences = application.get('PreferenceService')
    const wasActive = this.isActive()
    this.enabled = preferences.get(PREF.enabled)
    this.hideSearchAds = preferences.get(PREF.searchAds)
    if (wasActive !== this.isActive()) this.syncCosmeticPreloads()
    this.refreshOpenPages()
  }

  private syncCosmeticPreloads(): void {
    for (const guestSession of this.browserSessions()) {
      if (this.isActive()) this.enableCosmetic(guestSession)
      else this.disableCosmetic(guestSession)
    }
  }

  private enableCosmetic(guestSession: Electron.Session): void {
    if (this.cosmeticScripts.has(guestSession)) return
    const filePath = path.join(application.getPath('app.root.resources'), RESOURCE_DIR, PRELOAD_FILE)
    try {
      const id = guestSession.registerPreloadScript({ type: 'frame', filePath })
      this.cosmeticScripts.set(guestSession, id)
    } catch (error) {
      logger.warn('Failed to register the adblock preload', { error })
    }
  }

  private disableCosmetic(guestSession: Electron.Session): void {
    const id = this.cosmeticScripts.get(guestSession)
    if (id === undefined) return
    try {
      guestSession.unregisterPreloadScript(id)
    } catch (error) {
      logger.debug('Failed to unregister the adblock preload', { error })
    }
    this.cosmeticScripts.delete(guestSession)
  }

  private browserSessions(): Electron.Session[] {
    const partitions = [
      getWebviewPartition(WebviewSecurityProfile.MiniApp),
      getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
      ...STANDALONE_BROWSER_PARTITIONS
    ]
    return partitions.map((partition) => session.fromPartition(partition))
  }

  private isBrowserSession(candidate: Electron.Session): boolean {
    return this.browserSessions().includes(candidate)
  }

  private watchGuests(): void {
    const attach = (_event: Electron.Event, contents: Electron.WebContents) => this.attachGuest(contents)
    app.on('web-contents-created', attach)
    this.registerDisposable(() => app.removeListener('web-contents-created', attach))
    for (const contents of webContents.getAllWebContents()) this.attachGuest(contents)
  }

  private attachGuest(contents: Electron.WebContents): void {
    if (contents.isDestroyed() || !this.isBrowserSession(contents.session)) return
    if (this.searchAdsGuests.has(contents)) return
    this.searchAdsGuests.add(contents)
    const id = contents.id
    contents.on('dom-ready', () => this.injectPageCss(contents))
    contents.once('destroyed', () => this.injectedCss.delete(id))
  }

  /**
   * Replaces the stylesheet this service owns on one page. Search-result rules
   * and AI-written cosmetic rules share one key so removing a rule can take the
   * old selectors with it; the engine-injected styles are managed separately by
   * the preload. Injections are serialized per page, otherwise two overlapping
   * runs would each insert a sheet while only one key survives.
   */
  private injectPageCss(contents: Electron.WebContents): void {
    if (contents.isDestroyed()) return
    const id = contents.id
    void this.cssInjections
      .queue(id, async () => {
        if (contents.isDestroyed()) return
        const url = contents.getURL()
        const css = [this.hideSearchAds ? getSearchAdsCss(url) : '', this.customCssFor(url)].filter(Boolean).join('\n')
        const previous = this.injectedCss.get(id)
        if (!css) {
          if (previous) {
            await contents.removeInsertedCSS(previous).catch(() => undefined)
            this.injectedCss.delete(id)
          }
          return
        }
        if (previous) {
          await contents.removeInsertedCSS(previous).catch(() => undefined)
          this.injectedCss.delete(id)
        }
        const key = await contents.insertCSS(css, { cssOrigin: 'user' })
        if (!contents.isDestroyed()) this.injectedCss.set(id, key)
      })
      .catch((error) => {
        logger.debug('Failed to inject page styles', { error })
      })
  }

  private refreshOpenPages(): void {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed() || !this.isBrowserSession(contents.session)) continue
      this.injectPageCss(contents)
    }
  }
}
