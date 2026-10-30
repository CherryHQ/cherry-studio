import path from 'node:path'

import { application } from '@application'
import { agentDataDirectoryPath, assertAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import { BaseService, type Disposable, Emitter, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { MemoryScope } from '@shared/types/memory'

import type { MemoryAuthority } from './memoryAuthority'
import type { MemoryMutationSource } from './memoryBackups'
import {
  type MemoryAccess,
  type MemoryApproval,
  type MemoryCommitResult,
  type MemoryMutation,
  MemoryStore
} from './MemoryStore'

export interface MemorySession extends Disposable {
  readonly scope: MemoryScope
  list(): ReturnType<MemoryStore['list']>
  entry(): ReturnType<MemoryStore['entry']>
  read(target: string): ReturnType<MemoryStore['read']>
  commit(
    mutations: readonly MemoryMutation[],
    approve: MemoryApproval,
    readReceipts?: readonly string[]
  ): ReturnType<MemoryStore['commit']>
  previewClear(): ReturnType<MemoryStore['previewClear']>
  clear(token: string, approve: MemoryApproval): ReturnType<MemoryStore['clear']>
  previewRecovery(): ReturnType<MemoryStore['previewRecovery']>
  recover(token: string, approve: MemoryApproval): ReturnType<MemoryStore['recover']>
}

@Injectable('MemoryService')
@ServicePhase(Phase.WhenReady)
export class MemoryService extends BaseService {
  private readonly stores = new Map<string, Promise<MemoryStore>>()
  private readonly work = createInFlightWorkTracker()
  private readonly pauses = new Set<symbol>()
  private readonly sessions = new Set<Disposable>()
  private stopped = false
  private generation = 0
  private readonly changed = new Emitter<{
    scope: MemoryScope
    source: MemoryMutationSource
    result: MemoryCommitResult
  }>()
  readonly onChanged = this.changed.event
  private readonly invalidated = new Emitter<MemoryScope | undefined>()
  readonly onInvalidated = this.invalidated.event

  protected override onReady(): void {
    this.stopped = false
  }

  /** Authority objects are created only by main-process runtime/editor owners. */
  open(authority: MemoryAuthority, source: 'controlled' | 'dreaming' | 'migration' = 'controlled'): MemorySession {
    authority.assertAuthorized()
    const scope = Object.freeze({ ...authority.scope })
    const generation = this.generation
    let disposed = false
    const subscription = authority.onRevoked?.(() => {
      disposed = true
    })
    const release = {
      dispose: () => {
        disposed = true
        subscription?.dispose()
        this.sessions.delete(release)
      }
    }
    this.sessions.add(release)
    const access: MemoryAccess = {
      assertAuthorized: () => {
        if (disposed || this.stopped || generation !== this.generation) throw new Error('Memory session expired')
        if (this.pauses.size) throw new Error('Memory operations are paused')
        return authority.assertAuthorized()
      }
    }
    const run = <T>(operation: (store: MemoryStore) => Promise<T>): Promise<T> =>
      this.work.track(
        (async () => {
          access.assertAuthorized()
          const store = await this.getStore(scope)
          access.assertAuthorized()
          return operation(store)
        })()
      )
    const notify = (source: MemoryMutationSource, result: MemoryCommitResult) => {
      if (result.batchId) this.changed.fire({ scope, source, result })
      return result
    }
    return {
      scope,
      dispose: release.dispose,
      list: () => run((store) => store.list(access)),
      entry: () => run((store) => store.entry(access)),
      read: (target) => run((store) => store.read(access, target)),
      commit: (mutations, approve, readReceipts) =>
        run(async (store) => notify(source, await store.commit(access, mutations, source, approve, { readReceipts }))),
      previewClear: () => run((store) => store.previewClear(access)),
      clear: (token, approve) =>
        run(async (store) => {
          this.invalidated.fire(scope)
          return notify('clear', await store.clear(access, token, approve))
        }),
      previewRecovery: () => run((store) => store.previewRecovery(access)),
      recover: (token, approve) =>
        run(async (store) => {
          this.invalidated.fire(scope)
          return notify('recovery', await store.recover(access, token, approve))
        })
    }
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason)
    this.pauses.add(token)
    this.invalidated.fire(undefined)
    return { dispose: () => void this.pauses.delete(token) }
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ settled: boolean }> {
    return { settled: await this.work.drain(options) }
  }

  /** A restored filesystem/database must never reuse receipts from the previous state. */
  invalidateAll(): void {
    this.generation++
    this.invalidated.fire(undefined)
    for (const session of this.sessions) session.dispose()
  }

  protected async onStop(): Promise<void> {
    this.stopped = true
    this.invalidateAll()
    if (!(await this.work.drain())) throw new Error('Memory operations did not finish before shutdown')
    this.stores.clear()
  }

  protected onDestroy(): void {
    this.changed.dispose()
    this.invalidated.dispose()
  }

  private async getStore(scope: MemoryScope): Promise<MemoryStore> {
    const key = scope.kind === 'shared' ? 'shared' : `agent/${scope.agentId}`
    let root: string
    if (scope.kind === 'private') {
      const agentsRoot = application.getPath('feature.agents.data')
      root = agentDataDirectoryPath(agentsRoot, scope.agentId)
      await assertAgentStorageDirectory(agentsRoot, root)
    } else {
      root = application.getPath('feature.memory.data')
    }
    let pending = this.stores.get(key)
    if (!pending) {
      const store = new MemoryStore(root, path.join(application.getPath('feature.memory.backups'), key))
      pending = store.initialize().then(() => store)
      this.stores.set(key, pending)
      void pending.catch(() => {
        if (this.stores.get(key) === pending) this.stores.delete(key)
      })
    }
    return pending
  }
}
