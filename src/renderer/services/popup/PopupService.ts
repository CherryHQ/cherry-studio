import { loggerService } from '@logger'

import type { ComponentPopupEntry, ConfirmPopupProps, ConfirmPopupType, PopupComponent, PopupEntry } from './types'

const logger = loggerService.withContext('PopupService')

/**
 * Exit-phase duration. Kept equal to the @cherrystudio/ui Dialog close animation
 * (Tailwind `duration-200`); the two live in different packages, so update both
 * together if that animation changes.
 */
export const POPUP_EXIT_MS = 200

/**
 * Module-level store behind services/popup. Holds data-only entries (component
 * popups from createPopup + confirm prefabs) and drives them through a two-phase
 * close. Rendered by each window's <PopupHost/> via useSyncExternalStore; it owns
 * no React state and no JSX itself.
 */
class PopupService {
  private entries: PopupEntry[] = []
  private readonly listeners = new Set<() => void>()
  private readonly exitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private idCounter = 0

  generateInstanceId = (): string => `popup-${++this.idCounter}`

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PopupEntry[] => this.entries

  private notify() {
    this.listeners.forEach((listener) => listener())
  }

  /** A PopupHost is mounted and subscribed (so an entry would actually render). */
  private hasHost(): boolean {
    return this.listeners.size > 0
  }

  private add(entry: PopupEntry) {
    this.entries = [...this.entries, entry]
    this.notify()
  }

  private remove(instanceId: string) {
    const timer = this.exitTimers.get(instanceId)
    if (timer) {
      clearTimeout(timer)
      this.exitTimers.delete(instanceId)
    }
    this.entries = this.entries.filter((entry) => entry.instanceId !== instanceId)
    this.notify()
  }

  /**
   * Settle a popup: resolve its promise, begin the exit phase (`open: false`), then
   * remove it after POPUP_EXIT_MS so the close animation can play. Idempotent — a
   * repeat call after the entry is closing (or already gone) is a no-op, which is
   * what makes the injected `resolve` safe to call from every dismissal path.
   */
  settle(instanceId: string, result: unknown): void {
    const entry = this.entries.find((current) => current.instanceId === instanceId)
    if (!entry || !entry.open) return

    entry.resolve(result)
    this.entries = this.entries.map((current) =>
      current.instanceId === instanceId ? { ...current, open: false } : current
    )
    this.notify()
    this.exitTimers.set(
      instanceId,
      setTimeout(() => this.remove(instanceId), POPUP_EXIT_MS)
    )
  }

  /**
   * Mount a component popup. Called by createPopup, which owns the instanceId and
   * single-flight. With no host mounted it resolves `dismissResult` immediately
   * (dev warning) rather than hanging — popups are not usable on a startup path.
   */
  showComponent<P extends object, R>(
    Component: PopupComponent<P, R>,
    props: P,
    instanceId: string,
    dismissResult: R
  ): Promise<R> {
    if (!this.hasHost()) {
      logger.warn('createPopup show() with no PopupHost mounted; resolving dismissResult', { instanceId })
      return Promise.resolve(dismissResult)
    }

    let resolveFn!: (result: R) => void
    const promise = new Promise<R>((resolve) => {
      resolveFn = resolve
    })

    this.add({
      kind: 'component',
      instanceId,
      open: true,
      Component: Component as ComponentPopupEntry['Component'],
      props: props as Record<string, unknown>,
      resolve: resolveFn as (result: unknown) => void
    })

    return promise
  }

  /** Mount a confirm-family prefab. No host → resolves `false` immediately (dev warning). */
  showConfirm(confirmType: ConfirmPopupType, props: ConfirmPopupProps): Promise<boolean> {
    if (!this.hasHost()) {
      logger.warn('confirm popup with no PopupHost mounted; resolving false', { confirmType })
      return Promise.resolve(false)
    }

    const instanceId = this.generateInstanceId()
    let resolveFn!: (result: boolean) => void
    const promise = new Promise<boolean>((resolve) => {
      resolveFn = resolve
    })

    this.add({
      kind: 'confirm',
      instanceId,
      open: true,
      confirmType,
      props,
      resolve: resolveFn as (result: unknown) => void
    })

    return promise
  }
}

export const popupService = new PopupService()
