import type { WebviewTag } from 'electron'

import { cacheService } from '@renderer/data/CacheService'
import { getBrowserStartPageUrl, rememberBrowserPageUrl } from '@renderer/services/browserStartPage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn } from '@shared/ai/transport'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

export interface AgentBrowserResource {
  sessionId: string
  pageId: string
  sourceUrl: string
  securityProfile: WebviewSecurityProfile
  anchor: HTMLElement | null
  overlays: HTMLElement | null
  reloadKey?: number | string
  guest: WebviewTag | null
  bindingId?: string
  executing: boolean
  url: string
  title: string
  favicon?: string
  ready: boolean
  loading: boolean
  failed: boolean
  previewKey?: string
}

interface BrowserPages {
  pages: readonly AgentBrowserResource[]
  activePageId?: string
}
const emptyPages: readonly AgentBrowserResource[] = []

/** Guests outlive presentation subscriptions and retain active Agent turns without an app tab. */
export class AgentBrowserRuntimeService {
  private readonly owners = new Map<string, Set<string>>()
  private readonly sessions = new Map<string, BrowserPages>()
  private readonly listeners = new Set<() => void>()
  private ids: readonly string[] = []
  private readonly turnSubscriptions = new Map<string, () => void>()

  constructor(private readonly scope: 'agent' | 'topic' = 'agent') {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getIds = () => this.ids
  hasSession = (sessionId: string) => this.sessions.has(sessionId)
  getPages = (sessionId: string) => this.sessions.get(sessionId)?.pages ?? emptyPages
  get = (sessionId: string, pageId = this.sessions.get(sessionId)?.activePageId) =>
    this.getPages(sessionId).find((page) => page.pageId === pageId)

  declare(sessionId: string, ownerTabId: string): void {
    for (const [previousSessionId, previousOwners] of this.owners) {
      if (previousSessionId === sessionId || !previousOwners.delete(ownerTabId)) continue
      this.releaseUnowned(previousSessionId)
    }
    const owners = this.owners.get(sessionId) ?? new Set<string>()
    owners.add(ownerTabId)
    this.owners.set(sessionId, owners)
    this.turnSubscriptions.get(sessionId)?.()
    this.turnSubscriptions.delete(sessionId)
  }

  ensure(sessionId: string, url?: string, profile: WebviewSecurityProfile = WebviewSecurityProfile.AgentBrowser): void {
    const existing = this.get(sessionId)
    if (existing) {
      if (url) this.navigate(sessionId, existing.pageId, url, profile)
    } else if (!this.hasSession(sessionId) || url) {
      this.openPage(sessionId, url, profile)
    }
  }

  openStartPage(sessionId: string): string | undefined {
    return this.openPage(sessionId, getBrowserStartPageUrl(`${this.scope}:${sessionId}`), undefined, { reuse: false })
  }

  openPage(
    sessionId: string,
    url = 'about:blank',
    profile: WebviewSecurityProfile = WebviewSecurityProfile.AgentBrowser,
    options: { pageId?: string; activate?: boolean; previewKey?: string; reuse?: boolean } = {}
  ): string | undefined {
    if (!this.owners.has(sessionId)) return
    if (url !== 'about:blank') url = normalizeBrowserEntryUrl(url)
    const pages = this.getPages(sessionId)
    const securityProfile = url.startsWith('file:') ? WebviewSecurityProfile.AgentHtmlArtifact : profile
    const existing = pages.find((page) =>
      options.pageId
        ? page.pageId === options.pageId
        : options.previewKey
          ? page.previewKey === options.previewKey
          : options.reuse !== false &&
            url !== 'about:blank' &&
            page.url === url &&
            page.securityProfile === securityProfile
    )
    const activate = options.activate ?? true
    if (existing) {
      if (options.previewKey || options.pageId) this.navigate(sessionId, existing.pageId, url, securityProfile)
      if (activate) this.activate(sessionId, existing.pageId)
      return existing.pageId
    }
    const pageId = options.pageId ?? crypto.randomUUID()
    const previous = this.sessions.get(sessionId)
    this.sessions.set(sessionId, {
      pages: [
        ...pages,
        {
          sessionId,
          pageId,
          sourceUrl: url,
          securityProfile,
          url,
          title: '',
          anchor: null,
          overlays: null,
          guest: null,
          executing: false,
          ready: false,
          loading: true,
          failed: false,
          previewKey: options.previewKey
        }
      ],
      activePageId: activate || !previous?.activePageId ? pageId : previous.activePageId
    })
    this.ids = [...this.sessions.keys()]
    this.emit()
    return pageId
  }

  navigate(sessionId: string, pageId: string, url: string, profile?: WebviewSecurityProfile): void {
    const existing = this.get(sessionId, pageId)
    if (!existing) return
    if (url !== 'about:blank') url = normalizeBrowserEntryUrl(url)
    const securityProfile = url.startsWith('file:')
      ? WebviewSecurityProfile.AgentHtmlArtifact
      : (profile ??
        (existing.securityProfile === WebviewSecurityProfile.AgentHtmlArtifact
          ? WebviewSecurityProfile.AgentBrowser
          : existing.securityProfile))
    this.update(sessionId, { sourceUrl: url, securityProfile }, pageId)
  }

  activate(sessionId: string, pageId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.activePageId === pageId || !this.get(sessionId, pageId)) return
    const page = this.get(sessionId, pageId)
    if (page?.ready && page.securityProfile === WebviewSecurityProfile.AgentBrowser)
      rememberBrowserPageUrl(`${this.scope}:${sessionId}`, page.url)
    this.sessions.set(sessionId, { ...session, activePageId: pageId })
    this.emit()
  }

  closePage(sessionId: string, pageId: string): void {
    this.closePages(sessionId, [pageId])
  }

  closePages(sessionId: string, pageIds: readonly string[]): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const closed = new Set(pageIds)
    const pages = session.pages.filter((page) => !closed.has(page.pageId))
    if (pages.length === session.pages.length) return
    const activeIndex = session.pages.findIndex((page) => page.pageId === session.activePageId)
    this.sessions.set(sessionId, {
      pages,
      activePageId:
        session.activePageId && closed.has(session.activePageId)
          ? (session.pages.slice(activeIndex + 1).find((page) => !closed.has(page.pageId)) ?? pages.at(-1))?.pageId
          : session.activePageId
    })
    this.emit()
  }

  update(sessionId: string, patch: Partial<Omit<AgentBrowserResource, 'sessionId' | 'pageId'>>, pageId?: string): void {
    const existing = this.get(sessionId, pageId)
    const session = this.sessions.get(sessionId)
    if (
      !existing ||
      !session ||
      Object.entries(patch).every(([key, value]) => existing[key as keyof AgentBrowserResource] === value)
    )
      return
    if (
      patch.url !== undefined &&
      existing.securityProfile === WebviewSecurityProfile.AgentBrowser &&
      session.activePageId === existing.pageId
    )
      rememberBrowserPageUrl(`${this.scope}:${sessionId}`, patch.url)
    this.sessions.set(sessionId, {
      ...session,
      pages: session.pages.map((page) => (page === existing ? { ...page, ...patch } : page))
    })
    this.emit()
  }

  reconcileOwners(tabIds: ReadonlySet<string>): void {
    for (const [sessionId, owners] of this.owners) {
      for (const id of owners) if (!tabIds.has(id)) owners.delete(id)
      this.releaseUnowned(sessionId)
    }
  }

  private releaseUnowned(sessionId: string): void {
    if (this.owners.get(sessionId)?.size) return
    if (this.scope === 'agent') {
      const key = `topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const
      if (classifyTurn(cacheService.getShared(key)?.status).isTurnActive) {
        if (!this.turnSubscriptions.has(sessionId)) {
          this.turnSubscriptions.set(
            sessionId,
            cacheService.subscribe(key, () => this.releaseUnowned(sessionId))
          )
        }
        return
      }
    }
    this.close(sessionId)
  }

  syncOwners(sessionByTab: ReadonlyMap<string, string>): void {
    this.owners.clear()
    for (const [tabId, sessionId] of sessionByTab) {
      const owners = this.owners.get(sessionId) ?? new Set<string>()
      owners.add(tabId)
      this.owners.set(sessionId, owners)
    }
    for (const sessionId of this.sessions.keys()) {
      if (!this.owners.has(sessionId)) this.close(sessionId)
    }
  }

  close(sessionId: string): void {
    this.turnSubscriptions.get(sessionId)?.()
    this.turnSubscriptions.delete(sessionId)
    this.owners.delete(sessionId)
    if (!this.sessions.delete(sessionId)) return
    this.ids = [...this.sessions.keys()]
    this.emit()
  }

  dispose(): void {
    for (const unsubscribe of this.turnSubscriptions.values()) unsubscribe()
    this.turnSubscriptions.clear()
    this.owners.clear()
    this.sessions.clear()
    this.ids = []
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const agentBrowserRuntimeService = new AgentBrowserRuntimeService()
export const topicBrowserRuntimeService = new AgentBrowserRuntimeService('topic')
