import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { ContractHarness, ScriptedReply } from '../contract/harness'
import type { JobKind, Step } from '../core/decisions'
import type { ConversationFacts } from '../core/facts'
import type { Key } from '../core/keys'
import type { BoundPorts, HarnessPorts, LifecycleHandlers, PortMethod, TransactResult } from '../ports/harness'
import { message, never, resumeRun, retract, type RunHost, start, stopRun, submit, waitFor } from './fakeRuns'
import {
  addThread,
  append,
  applyOps,
  buildFacts,
  createEpoch,
  createState,
  type Epoch,
  inputDone,
  type JobRecord,
  latestStart,
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
  /** Seeds the script of each conversation as it is created (children created inside jobs included). */
  readonly scripts?: (thread: ThreadId, lineage: ConversationFacts['lineage']) => readonly ScriptedReply[]
}
export interface FakeHarness extends ContractHarness {
  /** Await points passed since creation. */
  readonly awaitPoints: number
  /** Crash at the n-th await point from now (1-based): that point and all later work of this epoch never settle. */
  crashAt(n: number): void
  /** Resolves when the armed crash fires; already resolved if it has fired. */
  whenCrashed(): Promise<void>
  /** Ids of the entries each model request on `thread` saw, after the context filter. */
  requestLog(thread: ThreadId): readonly (readonly ItemId[])[]
  /** The persistent state as JSON, for crash-equivalence checks (see Step 4). */
  persistentLog(): JsonValue
}

/**
 * One call's ports: they work while it runs, reject once it ended, and never settle once its epoch died. `reopen` marks
 * an `onOpen` of a restart and collects the jobs it ensures, which start once every `onOpen` has run. `signal` is a
 * tool call's abort signal.
 */
type Scope = {
  readonly epoch: Epoch
  ended: boolean
  readonly owner?: Owner
  readonly reopen?: JobRecord[]
  readonly signal?: AbortSignal
}

const REOPEN_RULE = 'onOpen on reopen calls only ledger.*, turns.stop, helpers.stop and clock.now (H12)'
/** H12: on Durable a submit or a wait from `onOpen` enables scheduling before resume, so the fake refuses them. */
function reopenPorts(ports: BoundPorts): BoundPorts {
  const refuse = (method: PortMethod) => () => Promise.reject(new Error(`${method} is refused: ${REOPEN_RULE}`))
  return {
    ...ports,
    turns: { ...ports.turns, start: refuse('turns.start'), retract: refuse('turns.retract') },
    helpers: { ...ports.helpers, message: refuse('helpers.message'), awaitAnswer: refuse('helpers.awaitAnswer') },
    waits: { untilIdle: refuse('waits.untilIdle'), untilDone: refuse('waits.untilDone') },
    memory: { remember: refuse('memory.remember') }
  }
}

export function createFakeHarness(options: FakeHarnessOptions = {}): FakeHarness {
  const state = createState()
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
  const openScope = (reopen?: JobRecord[]): Scope => ({ epoch, ended: false, reopen })
  const host: RunHost = {
    state,
    stopMarks: new WeakSet(),
    epoch: () => epoch,
    alive,
    point,
    toolScope(e, owner, signal) {
      const scope: Scope = { epoch: e, ended: false, owner, signal }
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
    const ports: BoundPorts = {
      ledger: {
        read: (id) => enter(scope, () => buildFacts(state, id)),
        transact: (id, decide) => enter(scope, () => commit(scope, id, decide)),
        modelContext: (id) => enter(scope, () => modelContext(state, scope.epoch, thread(id)))
      },
      turns: {
        start: (id, input, key) => enter(scope, () => start(host, thread(id), input, key)),
        retract: (id, key) => enter(scope, () => retract(host, thread(id), key)),
        stop: (id, _cause, turn) =>
          enter(scope, () =>
            turn === undefined || latestStart(thread(id)) === turn ? stopRun(host, thread(id)) : undefined
          )
      },
      helpers: {
        message: (child, input, key, run) =>
          enter(scope, async () => {
            const target = thread(child)
            const accepted = message(host, target, input, key, run)
            if (accepted.status !== 'queued') return accepted
            // A steer answers once a boundary took it, or once its run ended first or its tool call aborted (G-C5, H3).
            const submission = target.submissions.get(key)!
            const withdraw = () => {
              if (alive(scope.epoch)) retract(host, target, key)
            }
            if (scope.signal?.aborted) withdraw()
            scope.signal?.addEventListener('abort', withdraw, { once: true })
            try {
              await waitFor(scope.epoch, child, () => submission.state !== 'queued')
            } finally {
              scope.signal?.removeEventListener('abort', withdraw)
            }
            return submission.state === 'withdrawn' ? { run: accepted.run, status: 'withdrawn' } : accepted
          }),
        awaitAnswer: (child, run, key) =>
          enter(scope, async () => {
            const target = thread(child)
            const submission = target.submissions.get(key)
            if (!submission) throw new Error(`No message ${key} was sent to ${child}`)
            // The run that took the message; a message withdrawn before it ran answers with the run it was accepted into.
            const ended = () => {
              const answering = submission.run ?? (submission.state === 'withdrawn' ? run : undefined)
              return answering === undefined ? undefined : target.ends.get(answering)
            }
            await waitFor(scope.epoch, child, () => ended() !== undefined)
            return ended()!.answer
          }),
        stop: (child, run) =>
          enter(scope, () => (thread(child).active?.run === run ? stopRun(host, thread(child)) : undefined))
      },
      waits: {
        untilIdle: (id) => enter(scope, () => waitFor(scope.epoch, id, () => !thread(id).active)),
        untilDone: (id, key) => enter(scope, () => waitFor(scope.epoch, id, () => inputDone(thread(id), key)))
      },
      memory: { remember: (name, produce) => enter(scope, () => remember(scope, name, produce)) },
      clock: { now: () => 0 }
    }
    return scope.reopen ? reopenPorts(ports) : ports
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
    if (scope.reopen) scope.reopen.push(...applied.jobs)
    else for (const job of applied.jobs) startJob(job)
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
      .then(async (outcome) => {
        scope.ended = true
        // Ending the job is a commit of its own, so a crash can fall after its last step (Stage A review M12).
        await point(e)
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

  async function within<T>(body: (ports: BoundPorts) => Promise<T>, reopen?: JobRecord[]): Promise<T> {
    const scope = openScope(reopen)
    try {
      return await body(bound(scope))
    } finally {
      scope.ended = true
    }
  }
  async function lifecycle(
    call: (handlers: LifecycleHandlers, ports: BoundPorts) => Promise<void>,
    reopen?: JobRecord[]
  ): Promise<void> {
    const handlers = epoch.lifecycle
    if (handlers) await within((ports) => call(handlers, ports), reopen)
  }

  options.install?.(installed)

  return {
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
      const target = threadOf(state, thread)
      const active = target.active
      if (active) {
        // A compaction during a run is one of its model requests (H12, H11).
        const lineage = target.lineage.kind === 'subagent' ? 'child' : 'root'
        if (!(epoch.meter?.allow(thread, active.requests, lineage).ok ?? true)) return
        active.requests += 1
      }
      const handlers = epoch.lifecycle
      if (handlers) {
        const key = `${thread}:${target.entries.at(-1)?.entry.id ?? 'start'}`
        const request = {
          key,
          reason: 'manual',
          messages: modelContext(state, epoch, target),
          signal: new AbortController().signal
        } as const
        if ('decline' in (await within((ports) => handlers.onCompacting(thread, request, ports)))) return
      }
      append(target, { kind: 'compaction', id: nextItem(state) })
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
      for (const job of state.jobs.values())
        if (job.state === 'live' && job.spec.onRestart === 'abandon') job.state = 'abandoned'
      // The 'resume' jobs, then those each onOpen ensures: Durable runs no task before resume.
      const jobs = [...state.jobs.values()].filter((job) => job.state === 'live')
      for (const thread of [...state.threads.values()])
        await lifecycle((handlers, ports) => handlers.onOpen(thread.id, { reopened: true }, ports), jobs)
      for (const job of jobs) startJob(job)
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
    requestLog: (thread) => threadOf(state, thread).requests,
    persistentLog: () => persistentSnapshot(state)
  }
}
