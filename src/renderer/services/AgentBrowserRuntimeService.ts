import type { WebviewTag } from 'electron'

import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

export interface AgentBrowserResource {
  sessionId: string
  sourceUrl: string
  securityProfile: WebviewSecurityProfile
  anchor: HTMLElement | null
  overlays: HTMLElement | null
  reloadKey?: number | string
  guest: WebviewTag | null
  url: string
  title: string
  ready: boolean
  loading: boolean
  failed: boolean
}

/** Browser instances outlive presentation subscriptions, but never their owning tabs. */
export class AgentBrowserRuntimeService {
  private readonly owners = new Map<string, Set<string>>()
  private readonly resources = new Map<string, AgentBrowserResource>()
  private readonly listeners = new Set<() => void>()
  private ids: readonly string[] = []

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getIds = () => this.ids
  get = (sessionId: string) => this.resources.get(sessionId)

  declare(sessionId: string, ownerTabId: string): void {
    const owners = this.owners.get(sessionId) ?? new Set<string>()
    owners.add(ownerTabId)
    this.owners.set(sessionId, owners)
  }

  ensure(sessionId: string, url?: string, profile: WebviewSecurityProfile = WebviewSecurityProfile.AgentBrowser): void {
    if (!this.owners.has(sessionId)) return
    const existing = this.resources.get(sessionId)
    if (existing && !url) return
    const sourceUrl = url ?? 'about:blank'
    const securityProfile = sourceUrl.startsWith('file:') ? WebviewSecurityProfile.AgentHtmlArtifact : profile
    if (existing) {
      if (existing.sourceUrl !== sourceUrl || existing.securityProfile !== securityProfile) {
        this.update(sessionId, { sourceUrl, securityProfile })
      }
      return
    }
    this.resources.set(sessionId, {
      sessionId,
      sourceUrl,
      securityProfile,
      url: sourceUrl,
      title: '',
      anchor: null,
      overlays: null,
      guest: null,
      ready: false,
      loading: true,
      failed: false
    })
    this.ids = [...this.resources.keys()]
    this.emit()
  }

  update(sessionId: string, patch: Partial<Omit<AgentBrowserResource, 'sessionId'>>): void {
    const existing = this.resources.get(sessionId)
    if (
      !existing ||
      Object.entries(patch).every(([key, value]) => existing[key as keyof AgentBrowserResource] === value)
    )
      return
    this.resources.set(sessionId, { ...existing, ...patch })
    this.emit()
  }

  reconcileOwners(tabIds: ReadonlySet<string>): void {
    for (const [sessionId, owners] of this.owners) {
      for (const id of owners) if (!tabIds.has(id)) owners.delete(id)
      if (owners.size === 0) {
        this.owners.delete(sessionId)
        this.resources.delete(sessionId)
      }
    }
    if (this.ids.length !== this.resources.size) {
      this.ids = [...this.resources.keys()]
      this.emit()
    }
  }

  close(sessionId: string): void {
    this.owners.delete(sessionId)
    if (!this.resources.delete(sessionId)) return
    this.ids = [...this.resources.keys()]
    this.emit()
  }

  dispose(): void {
    this.owners.clear()
    this.resources.clear()
    this.ids = []
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const agentBrowserRuntimeService = new AgentBrowserRuntimeService()
