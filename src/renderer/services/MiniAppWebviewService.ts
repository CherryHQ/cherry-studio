import type { WebviewTag } from 'electron'
import { isEqual } from 'es-toolkit/compat'

import type { MiniApp } from '@shared/data/types/miniApp'

export interface MiniAppDemand {
  appId: string
  app?: MiniApp
  awake: boolean
  visible: boolean
  protected: boolean
  lastAccessTime: number
}

export interface MiniAppResource {
  app: MiniApp
  instance: number
  element: WebviewTag | null
  loaded: boolean
  visible: boolean
}

export class MiniAppWebviewService {
  private resources: readonly MiniAppResource[] = []
  private nextInstance = 0
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.resources
  readonly get = (appId: string) => this.resources.find((resource) => resource.app.appId === appId)

  sync(demands: readonly MiniAppDemand[], capacity: number): void {
    const previous = new Map(this.resources.map((resource) => [resource.app.appId, resource]))
    const desired = new Map(demands.map((demand) => [demand.appId, demand]))
    const next: MiniAppResource[] = []
    for (const demand of demands) {
      const existing = previous.get(demand.appId)
      const app = demand.app ?? existing?.app
      if (!app || !demand.awake || (!existing && !demand.visible)) continue
      if (existing) {
        next.push(
          isEqual(existing.app, app) && existing.visible === demand.visible
            ? existing
            : {
                ...existing,
                app,
                visible: demand.visible,
                loaded: existing.loaded && existing.app.url === app.url
              }
        )
      } else {
        next.push({ app, instance: ++this.nextInstance, element: null, loaded: false, visible: demand.visible })
      }
    }
    const candidates = next
      .filter((item) => {
        const demand = desired.get(item.app.appId)!
        return !demand.visible && !demand.protected
      })
      .sort((a, b) => desired.get(a.app.appId)!.lastAccessTime - desired.get(b.app.appId)!.lastAccessTime)
    const evicted = new Set(candidates.slice(0, Math.max(0, next.length - capacity)))
    // Preserve insertion order: moving a live Electron webview can recreate its guest.
    const surviving = new Map(next.filter((item) => !evicted.has(item)).map((item) => [item.app.appId, item]))
    const ordered = this.resources.flatMap((item) => {
      const updated = surviving.get(item.app.appId)
      if (!updated) return []
      surviving.delete(item.app.appId)
      return [updated]
    })
    this.publish([...ordered, ...surviving.values()])
  }

  bind(appId: string, instance: number, element: WebviewTag | null): void {
    this.update(appId, instance, { element, loaded: false })
  }

  reportLoaded(appId: string, instance: number, loaded: boolean): void {
    const resource = this.get(appId)
    if (loaded && !resource?.element) return
    this.update(appId, instance, { loaded })
  }

  private update(appId: string, instance: number, patch: Partial<Pick<MiniAppResource, 'element' | 'loaded'>>): void {
    const current = this.get(appId)
    if (
      !current ||
      current.instance !== instance ||
      Object.entries(patch).every(([key, value]) => current[key as keyof MiniAppResource] === value)
    )
      return
    this.publish(this.resources.map((item) => (item === current ? { ...item, ...patch } : item)))
  }

  dispose(): void {
    this.publish([])
  }

  private publish(next: readonly MiniAppResource[]): void {
    if (next.length === this.resources.length && next.every((item, i) => item === this.resources[i])) return
    this.resources = next
    for (const listener of this.listeners) listener()
  }
}

export const miniAppWebviewService = new MiniAppWebviewService()
export const getWebviewElement = (appId: string) => miniAppWebviewService.get(appId)?.element ?? null
export const getWebviewLoaded = (appId: string) => miniAppWebviewService.get(appId)?.loaded ?? false
export const onWebviewElementChange = (_appId: string, listener: () => void) =>
  miniAppWebviewService.subscribe(listener)
export const onWebviewStateChange = (appId: string, listener: (loaded: boolean) => void) =>
  miniAppWebviewService.subscribe(() => listener(getWebviewLoaded(appId)))
