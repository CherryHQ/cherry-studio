import type { WebviewTag } from 'electron'
import { isEqual } from 'es-toolkit/compat'

export interface WebviewSource {
  src: string
  partition: string
}

export interface WebviewRequest {
  key: string
  source?: WebviewSource
  visible: boolean
  protected: boolean
  lastAccessTime: number
}

export interface WebviewResource {
  key: string
  source: WebviewSource
  instance: number
  element: WebviewTag | null
  loaded: boolean
  visible: boolean
  lastAccessTime: number
}

export class WebviewRuntimeService {
  private resources: readonly WebviewResource[] = []
  private nextInstance = 0
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.resources
  readonly get = (key: string) => this.resources.find((resource) => resource.key === key)

  sync(demands: readonly WebviewRequest[], capacity: number): void {
    const previous = new Map(this.resources.map((resource) => [resource.key, resource]))
    const desired = new Map(demands.map((demand) => [demand.key, demand]))
    const next: WebviewResource[] = []
    for (const demand of demands) {
      const existing = previous.get(demand.key)
      const source = demand.source ?? existing?.source
      if (!source || (!existing && !demand.visible)) continue
      if (existing && existing.source.partition === source.partition) {
        next.push(
          isEqual(existing.source, source) &&
            existing.visible === demand.visible &&
            existing.lastAccessTime === demand.lastAccessTime
            ? existing
            : {
                ...existing,
                source,
                visible: demand.visible,
                lastAccessTime: demand.lastAccessTime,
                loaded: existing.loaded && existing.source.src === source.src
              }
        )
      } else {
        next.push({
          key: demand.key,
          source,
          instance: ++this.nextInstance,
          element: null,
          loaded: false,
          visible: demand.visible,
          lastAccessTime: demand.lastAccessTime
        })
      }
    }
    const candidates = next
      .filter((item) => {
        const demand = desired.get(item.key)!
        return !demand.visible && !demand.protected
      })
      .sort((a, b) => desired.get(a.key)!.lastAccessTime - desired.get(b.key)!.lastAccessTime)
    const evicted = new Set(candidates.slice(0, Math.max(0, next.length - capacity)))
    // Preserve insertion order: moving a live Electron webview can recreate its guest.
    const surviving = new Map(next.filter((item) => !evicted.has(item)).map((item) => [item.key, item]))
    const ordered = this.resources.flatMap((item) => {
      const updated = surviving.get(item.key)
      if (!updated) return []
      surviving.delete(item.key)
      return [updated]
    })
    this.publish([...ordered, ...surviving.values()])
  }

  bind(key: string, instance: number, element: WebviewTag | null): void {
    this.update(key, instance, { element, loaded: false })
  }

  reportLoaded(key: string, instance: number, loaded: boolean): void {
    const resource = this.get(key)
    if (loaded && !resource?.element) return
    this.update(key, instance, { loaded })
  }

  private update(key: string, instance: number, patch: Partial<Pick<WebviewResource, 'element' | 'loaded'>>): void {
    const current = this.get(key)
    if (
      !current ||
      current.instance !== instance ||
      Object.entries(patch).every(([key, value]) => current[key as keyof WebviewResource] === value)
    )
      return
    this.publish(this.resources.map((item) => (item === current ? { ...item, ...patch } : item)))
  }

  dispose(): void {
    this.publish([])
  }

  release(key: string): void {
    this.publish(this.resources.filter((resource) => resource.key !== key))
  }

  private publish(next: readonly WebviewResource[]): void {
    if (next.length === this.resources.length && next.every((item, i) => item === this.resources[i])) return
    this.resources = next
    for (const listener of this.listeners) listener()
  }
}

export const webviewRuntimeService = new WebviewRuntimeService()
