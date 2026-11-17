import { randomUUID } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { WebContents } from 'electron'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileObservationResource } from '@shared/ipc/schemas/fileObservation'
import type { WindowId } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'

import type { CreateDirectoryWatcherOptions } from '../watcher'
import { WatchScope, type ObservationEvent, type ObservationLease } from './WatchScope'

interface SharedScope {
  scope: WatchScope
  references: number
}

interface Subscription {
  owner: ObservationOwner
  leases: ObservationLease[]
  state: FileObservationResource
  baseline: number
  active: boolean
  pending: boolean
}

interface ObservationOwner {
  windowId: WindowId
  webContents: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>
}

@Injectable('FileObservationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'PowerService'])
export class FileObservationService extends BaseService {
  private readonly allScopes = new Set<WatchScope>()
  private readonly scopes = new Map<string, SharedScope>()
  private readonly subscriptions = new Map<string, Subscription>()
  private readonly closing = new Set<Promise<void>>()
  private stopped = false

  protected override onInit(): void {
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => {
        for (const [subscriptionId, subscription] of this.subscriptions) {
          if (subscription.owner.windowId === id) this.close(subscriptionId)
        }
      })
    )
    this.registerDisposable(
      application.get('PowerService').onResume(() => {
        for (const shared of [...this.scopes.values()]) shared.scope.invalidate()
      })
    )
  }

  acquire(
    key: string,
    root: AbsoluteFilePath,
    options: CreateDirectoryWatcherOptions,
    listener: (event: ObservationEvent) => void
  ): ObservationLease {
    if (this.stopped) throw new Error('File observation stopped')
    let shared = this.scopes.get(key)
    if (!shared || shared.scope.needsRestart) {
      shared = { scope: new WatchScope(root, options), references: 0 }
      this.scopes.set(key, shared)
      this.allScopes.add(shared.scope)
    }
    const acquired = shared
    acquired.references++
    const subscription = acquired.scope.onEvent(listener)
    let released: Promise<void> | undefined
    const release = (): Promise<void> => {
      if (released) return released
      subscription.dispose()
      acquired.references--
      if (acquired.references) return (released = Promise.resolve())
      if (this.scopes.get(key) === acquired) this.scopes.delete(key)
      released = acquired.scope.close()
      this.closing.add(released)
      const closing = released
      void closing.finally(() => {
        this.closing.delete(closing)
        this.allScopes.delete(acquired.scope)
      })
      return released
    }
    return {
      ready: acquired.scope.ready,
      get revision() {
        return acquired.scope.revision
      },
      get coverage() {
        return acquired.scope.coverage
      },
      dispose: () => {
        void release()
      },
      disposeAsync: release
    }
  }

  private async fileTargets(target: AbsoluteFilePath): Promise<Map<string, boolean>> {
    const targets = new Map<string, boolean>()
    try {
      targets.set(await realpath(target), false)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      targets.set(target, false)
    }
    for (let candidate: string = target; ; candidate = path.dirname(candidate)) {
      try {
        if ((await lstat(candidate)).isSymbolicLink()) {
          const parent = await realpath(path.dirname(candidate))
          targets.set(path.join(parent, path.basename(candidate)), true)
        }
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      if (path.dirname(candidate) === candidate) break
    }
    return targets
  }

  private async acquireFile(
    target: string,
    binding: boolean,
    listener: (event: ObservationEvent) => void
  ): Promise<ObservationLease> {
    let root = path.dirname(target)
    for (;;) {
      try {
        if ((await stat(root)).isDirectory()) break
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      const parent = path.dirname(root)
      if (parent === root) throw new Error('No existing parent for file observation')
      root = parent
    }
    const physicalRoot = await realpath(root)
    const physicalTarget = path.join(physicalRoot, path.relative(root, target))
    const normalizedTarget = physicalTarget.replace(/\\/g, '/')
    return this.acquire(
      JSON.stringify(['file', physicalTarget, physicalRoot, binding]),
      AbsoluteFilePathSchema.parse(physicalRoot),
      {
        recursive: true,
        followSymlinks: false,
        // A file may already exist when its newly created parent's scan starts.
        emitInitial: !binding,
        maxDepth: path.relative(physicalRoot, physicalTarget).split(path.sep).length - 1,
        ignore: (candidate) => {
          const normalized = candidate.replace(/\\/g, '/')
          return normalized !== normalizedTarget && !normalizedTarget.startsWith(`${normalized}/`)
        }
      },
      listener
    )
  }

  async open(owner: ObservationOwner, target: AbsoluteFilePath): Promise<FileObservationResource> {
    const targets = await this.fileTargets(target)
    const subscriptionId = randomUUID()
    const subscription: Subscription = {
      owner,
      leases: [],
      state: { subscriptionId, revision: 0, coverage: 'stale' },
      baseline: 0,
      active: false,
      pending: false
    }
    this.subscriptions.set(subscriptionId, subscription)
    let bindingChanged = false
    const coverage = () =>
      subscription.leases.some((lease) => lease.coverage === 'unavailable')
        ? 'unavailable'
        : bindingChanged || subscription.leases.some((lease) => lease.coverage !== 'live')
          ? 'stale'
          : 'live'
    const targetsChanged = (current: Map<string, boolean>) =>
      current.size !== targets.size || [...targets].some(([address, binding]) => current.get(address) !== binding)
    const publish = () => {
      if (!this.subscriptions.has(subscriptionId)) return
      subscription.state = { subscriptionId, revision: subscription.state.revision + 1, coverage: coverage() }
      if (subscription.active) this.send(subscription)
      else subscription.pending = true
    }
    try {
      for (const [address, binding] of targets) {
        let live = false
        const lease = await this.acquireFile(address, binding, (event) => {
          if (!this.subscriptions.has(subscriptionId)) return
          if (event.kind === 'ready') live = true
          if (live && event.kind !== 'ready' && event.kind !== 'error' && event.kind !== 'stale') {
            void this.fileTargets(target).then(
              (current) => {
                bindingChanged ||= targetsChanged(current)
                publish()
              },
              () => {
                bindingChanged = true
                publish()
              }
            )
          } else publish()
        })
        live = lease.coverage === 'live'
        if (this.stopped || !this.subscriptions.has(subscriptionId)) {
          lease.dispose()
          throw new Error('File observation owner closed during acquisition')
        }
        subscription.leases.push(lease)
      }
      await Promise.all(subscription.leases.map((lease) => lease.ready))
      const currentTargets = await this.fileTargets(target)
      bindingChanged ||= targetsChanged(currentTargets)
      if (this.stopped || owner.webContents.isDestroyed() || !this.subscriptions.has(subscriptionId)) {
        throw new Error('File observation owner closed during acquisition')
      }
      subscription.state = { ...subscription.state, coverage: coverage() }
      subscription.baseline = subscription.state.revision
      subscription.pending = false
      return subscription.state
    } catch (error) {
      this.close(subscriptionId)
      throw error
    }
  }

  activateSubscription(subscriptionId: string, revision: number, ownerId: number): boolean {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.owner.webContents.id !== ownerId || subscription.baseline !== revision)
      return false
    subscription.active = true
    if (subscription.pending) {
      subscription.pending = false
      this.send(subscription)
    }
    return true
  }

  close(subscriptionId: string, ownerId?: number): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || (ownerId !== undefined && subscription.owner.webContents.id !== ownerId)) return
    this.subscriptions.delete(subscriptionId)
    for (const lease of subscription.leases) lease.dispose()
  }

  private send(subscription: Subscription): void {
    if (!subscription.owner.webContents.isDestroyed()) {
      subscription.owner.webContents.send(IpcChannel.IpcApi_Event, 'file.observe.changed', subscription.state)
    }
  }

  protected override async onStop(): Promise<void> {
    this.stopped = true
    for (const id of this.subscriptions.keys()) this.close(id)
    await Promise.all([...this.allScopes].map((scope) => scope.close()))
    this.allScopes.clear()
    this.scopes.clear()
    await Promise.all(this.closing)
  }
}
