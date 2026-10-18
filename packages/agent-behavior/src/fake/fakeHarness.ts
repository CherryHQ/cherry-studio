import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { ContractHarness, ScriptedReply } from '../contract/harness'
import type { JobKind, Step } from '../core/decisions'
import type { ConversationFacts } from '../core/facts'
import type { Key } from '../core/keys'
import type { BoundPorts, HarnessPorts, LifecycleHandlers, TransactResult } from '../ports/harness'
import { message, never, resumeRun, retract, type RunHost, start, stopRun, submit, waitFor } from './fakeRuns'
import {
  addThread,
  append,
  applyOps,
  buildFacts,
  createEpoch,
  createState,
  type Epoch,
  isIdle,
  type JobRecord,
  modelContext,
  nextItem,
  type Owner,
  persistentSnapshot,
  type Seed,
  threadOf,
  USER_INPUT
} from './fakeState'

export type FakeHarnessOptions = {
  /** Registers handlers at creation and again after every restart. */
  readonly install?: (ports: HarnessPorts) => void
  /** Start of the manual clock; default 0. */
  readonly now?: number
  /** Seeds the script of each conversation as it is created (children created inside jobs included). */
  readonly scripts?: (thread: ThreadId, lineage: ConversationFacts['lineage']) => readonly ScriptedReply[]
}
export interface FakeHarness extends ContractHarness {
  /** Ports bound to the current epoch's installation scope (what `install()` receives in Stage C). */
  readonly ports: HarnessPorts
  /** Await points passed since creation. */
  readonly awaitPoints: number
  /** Crash at the n-th await point from now (1-based): that point and all later work of this epoch never settle. */
  crashAt(n: number): void
  /** Resolves when the armed crash fires; already resolved if it has fired. */
  whenCrashed(): Promise<void>
  advanceClock(ms: number): void
  /** Ids of the entries each model request on `thread` saw, after the context filter. */
  requestLog(thread: ThreadId): readonly (readonly ItemId[])[]
  /** The persistent state as JSON, for crash-equivalence checks (see Step 4). */
  persistentLog(): JsonValue
}

/** One call's ports: they work while it runs, reject once it ended, and never settle once its epoch died. */
type Scope = { readonly epoch: Epoch; ended: boolean; readonly owner?: Owner }

export function createFakeHarness(options: FakeHarnessOptions = {}): FakeHarness {
  const state = createState(options.now ?? 0)
  const seed: Seed = (thread, lineage) => options.scripts?.(thread, lineage) ?? []
  let epoch = createEpoch()
  let awaitPoints = 0
  let crash: { readonly at: number; readonly fired: Promise<void>; fire(): void } | undefined
  let closed = false

  const alive = (e: Epoch): boolean => e === epoch && !e.dead
  function point(e: Epoch): Promise<void> {
    if (!alive(e)) return never()
    awaitPoints += 1
    if (crash?.at !== awaitPoints) return Promise.resolve()
    e.dead = true
    crash.fire()
    return never()
  }
  function assertOpen(): void {
    if (closed) throw new Error('The fake harness is closed')
  }
  /** A port call: an await point, then `body` in the same step as the check that the epoch still lives. */
  function enter<T>(scope: Scope, body: () => T | Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('The fake harness is closed'))
    if (!alive(scope.epoch)) return never()
    if (scope.ended) return Promise.reject(new Error('port used after its call ended'))
    return point(scope.epoch).then(() => (alive(scope.epoch) ? body() : never<T>()))
  }
  const openScope = (): Scope => ({ epoch, ended: false })
  const host: RunHost = {
    state,
    epoch: () => epoch,
    alive,
    point,
    toolScope(e, owner) {
      const scope: Scope = { epoch: e, ended: false, owner }
      return {
        ports: bound(scope),
        close: () => {
          scope.ended = true
        }
      }
    }
  }

  function bound(scope: Scope): BoundPorts {
    const thread = (id: ThreadId) => threadOf(state, id)
    return {
      ledger: {
        read: (id) => enter(scope, () => buildFacts(state, id)),
        transact: (id, decide) => enter(scope, () => commit(scope, id, decide)),
        modelContext: (id) => enter(scope, () => modelContext(thread(id)))
      },
      turns: {
        start: (id, input, key) => enter(scope, () => start(host, thread(id), input, key)),
        retract: (id, key) => enter(scope, () => retract(host, thread(id), key)),
        stop: (id) => enter(scope, () => stopRun(host, thread(id)))
      },
      helpers: {
        message: (child, input, key) => enter(scope, () => message(host, thread(child), input, key)),
        awaitAnswer: (child, run, key) =>
          enter(scope, async () => {
            const target = thread(child)
            if (!target.submissions.has(key)) throw new Error(`No message ${key} was sent to ${child}`)
            await waitFor(scope.epoch, child, () => target.ends.has(run))
            return target.ends.get(run)!.answer
          }),
        stop: (child, run) =>
          enter(scope, () => (thread(child).active?.run === run ? stopRun(host, thread(child)) : undefined))
      },
      waits: {
        untilIdle: (id) => enter(scope, () => waitFor(scope.epoch, id, () => isIdle(thread(id)))),
        untilTurnEnd: (id) =>
          enter(scope, () => {
            const run = thread(id).active?.run
            return waitFor(scope.epoch, id, () => thread(id).active?.run !== run)
          })
      },
      memory: { remember: (name, produce) => enter(scope, () => remember(scope, name, produce)) },
      clock: { now: () => state.clock }
    }
  }

  function installPorts(e: Epoch): HarnessPorts {
    return {
      ...bound({ epoch: e, ended: false }),
      jobs: {
        register: (kind, handler) => {
          e.jobHandlers.set(kind, handler)
        }
      },
      tools: {
        register: (tool) => {
          e.tools.set(tool.name, tool)
        }
      },
      toolGate: {
        register: (handlers) => {
          e.gate = handlers
        }
      },
      contextFilter: {
        register: (handler) => {
          e.filter = handler
        }
      },
      requestMeter: {
        register: (handler) => {
          e.meter = handler
        }
      },
      lifecycle: {
        register: (handlers) => {
          e.lifecycle = handlers
        }
      }
    }
  }
  let installed = installPorts(epoch)

  function commit<R extends JsonValue>(
    scope: Scope,
    thread: ThreadId,
    decide: (facts: ConversationFacts) => Step<R>
  ): TransactResult<R> {
    const step = decide(buildFacts(state, thread))
    const hasJob = (kind: JobKind) => scope.epoch.jobHandlers.has(kind)
    const applied = applyOps(state, thread, step.ops, { owner: scope.owner, hasJob, seed })
    for (const job of applied.jobs) startJob(job)
    return { result: step.result, effects: step.effects, spawned: applied.spawned }
  }

  /** Runs the job's handler from the next microtask, tracked at once so `settle` never misses it. */
  function startJob(job: JobRecord): void {
    const e = epoch
    const scope = openScope()
    const run = Promise.resolve()
      .then(() => e.jobHandlers.get(job.spec.kind)!(bound(scope), job.spec))
      .then(
        () => 'done' as const,
        () => 'failed' as const
      )
      .then((outcome) => {
        scope.ended = true
        if (!alive(e)) return never<void>()
        job.state = outcome
        e.jobRuns.delete(job.key)
      })
    e.jobRuns.set(job.key, run)
  }

  async function remember<T extends JsonValue>(scope: Scope, name: Key, produce: () => Promise<T>): Promise<T> {
    if (!state.memo.has(name)) {
      const value = await produce()
      if (!alive(scope.epoch)) return never()
      // A concurrent producer may have stored first; the first writer wins.
      if (!state.memo.has(name)) state.memo.set(name, value)
    }
    return state.memo.get(name) as T
  }

  async function within<T>(body: (ports: BoundPorts) => Promise<T>): Promise<T> {
    const scope = openScope()
    try {
      return await body(bound(scope))
    } finally {
      scope.ended = true
    }
  }
  async function lifecycle(call: (handlers: LifecycleHandlers, ports: BoundPorts) => Promise<void>): Promise<void> {
    const handlers = epoch.lifecycle
    if (handlers) await within((ports) => call(handlers, ports))
  }

  options.install?.(installed)

  return {
    get ports() {
      return installed
    },
    get awaitPoints() {
      return awaitPoints
    },
    async createThread() {
      assertOpen()
      const thread = addThread(state, { kind: 'root' }, seed)
      await lifecycle((handlers, ports) => handlers.onOpen(thread.id, { reopened: false }, ports))
      return thread.id
    },
    withCall(_thread, use) {
      assertOpen()
      return within(use)
    },
    script(thread, replies) {
      threadOf(state, thread).script.push(...replies)
    },
    async sendUser(thread, text) {
      assertOpen()
      state.counters.users += 1
      submit(host, threadOf(state, thread), `user:${state.counters.users}`, { kind: USER_INPUT, text, data: null })
    },
    async compact(thread) {
      assertOpen()
      append(threadOf(state, thread), { kind: 'compaction', id: nextItem(state) })
      await lifecycle((handlers, ports) => handlers.onCompacted(thread, ports))
    },
    async settle() {
      assertOpen()
      for (;;) {
        const pending = [...[...epoch.loops.values()].map((loop) => loop.done), ...epoch.jobRuns.values()]
        if (pending.length === 0) return
        await Promise.all(pending)
      }
    },
    async restart() {
      assertOpen()
      epoch.dead = true
      epoch = createEpoch()
      installed = installPorts(epoch)
      options.install?.(installed)
      for (const thread of [...state.threads.values()]) {
        thread.reopened = true
        await lifecycle((handlers, ports) => handlers.onOpen(thread.id, { reopened: true }, ports))
      }
      for (const job of state.jobs.values()) {
        if (job.state !== 'live') continue
        if (job.spec.onRestart === 'resume') startJob(job)
        else job.state = 'abandoned'
      }
      for (const thread of [...state.threads.values()]) if (thread.active) resumeRun(host, thread)
    },
    async close() {
      assertOpen()
      for (const thread of [...state.threads.values()])
        await lifecycle((handlers, ports) => handlers.onClose(thread.id, ports))
      closed = true
    },
    crashAt(n) {
      let fire!: () => void
      const fired = new Promise<void>((resolve) => {
        fire = resolve
      })
      crash = { at: awaitPoints + n, fired, fire }
    },
    whenCrashed: () => crash?.fired ?? never(),
    advanceClock(ms) {
      state.clock += ms
    },
    requestLog: (thread) => threadOf(state, thread).requests,
    persistentLog: () => persistentSnapshot(state)
  }
}
