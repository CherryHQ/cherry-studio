import type { ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent'

import type {
  BoundPorts,
  HarnessPorts,
  Key,
  LifecycleHandlers,
  PortMethod,
  SubagentOrigin
} from '@cherrystudio/agent-behavior'
import { type JsonValue, runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeSession } from '../session'
import { conversationExtension } from './extension'
import { commit, modelContext, readFacts } from './ledger'
import { retract, startTurn, stopRun, submit } from './runs'
import {
  type Adapter,
  type Conversation,
  type Installation,
  type JobRecord,
  newConversation,
  type Owner,
  piIdle,
  waitFor
} from './state'

export type BehaviorSessionRequest = {
  readonly sessionManager: SessionManager
  /** The adapter's extension; the session must install it. */
  readonly extension: ExtensionFactory
  /**
   * For a child: give it the model `origin.modelKey` names. The adapter's extension already leaves out the package's
   * `'parent-only'` tools; host-owned tools follow the host's own child configuration.
   */
  readonly child?: { readonly parent: ThreadId; readonly origin: SubagentOrigin }
}

export interface PiBehaviorOptions {
  /** Registers the package's handlers; called once, before any conversation opens. */
  readonly install: (ports: HarnessPorts) => void
  /** Builds the native session of a conversation the adapter opens (`createAgentRuntimeSession`, Pi's retry off). */
  readonly openSession: (request: BehaviorSessionRequest) => Promise<AgentRuntimeSession>
  /** Errors no caller awaits: a job that threw, a run that failed to start, an automatic compaction's `onCompacted`. */
  readonly onError?: (error: unknown) => void
}

/** The agent-behavior harness ports on native coding-agent sessions (README "Behavior ports"). */
export interface PiBehavior {
  /** Opens a conversation on `sessionManager`; `onOpen` has run when it resolves. */
  openConversation(sessionManager: SessionManager): Promise<ThreadId>
  /** Runs `use` with outbound ports bound to one host call on `thread`; they expire when `use` settles. */
  withCall<T>(thread: ThreadId, use: (ports: BoundPorts) => Promise<T>): Promise<T>
  /** A person's text: starts a run when the conversation is idle, otherwise waits in the inbox for a run of its own. */
  submitUser(thread: ThreadId, text: string): Promise<void>
  /** Compacts now; resolves once `onCompacted` has run. */
  compact(thread: ThreadId): Promise<void>
  /** Resolves once no run is active and no job is live; inputs a failed run left do not count. */
  settled(): Promise<void>
  /** Stops every run, calls `onClose` for every conversation and disposes the sessions. */
  close(): Promise<void>
}

type Scope = { ended: boolean; readonly owner?: Owner }

const later = (method: PortMethod) => (): Promise<never> =>
  Promise.reject(new Error(`${method} is not implemented yet`))

export function createPiBehavior(options: PiBehaviorOptions): PiBehavior {
  const conversations = new Map<ThreadId, Conversation>()
  const jobs = new Map<string, JobRecord>()
  const memo = new Map<string, JsonValue>()
  const pending = new Set<Promise<unknown>>()
  const installation: Installation = { tools: new Map(), jobs: new Map() }
  const installScope: Scope = { ended: false }
  let closed = false
  let users = 0
  let lastNow = 0
  const clock = { now: () => (lastNow = Math.max(lastNow, Date.now())) }

  function conversation(thread: ThreadId): Conversation {
    const found = conversations.get(thread)
    if (!found) throw new Error(`Unknown thread ${thread}`)
    return found
  }
  function track<T>(work: Promise<T>): Promise<T> {
    pending.add(work)
    const forget = () => {
      pending.delete(work)
    }
    work.then(forget, forget)
    return work
  }
  const report = (error: unknown) => options.onError?.(error)

  /** One port call: rejects once its call ended or the harness closed; `body` runs synchronously up to its first await. */
  async function enter<T>(scope: Scope, body: () => T | Promise<T>): Promise<T> {
    if (closed) throw new Error('The coding-agent harness is closed')
    if (scope.ended) throw new Error('port used after its call ended')
    return body()
  }
  async function remember<T extends JsonValue>(name: Key, produce: () => Promise<T>): Promise<T> {
    if (!memo.has(name)) {
      const value = await produce()
      // A concurrent producer may have stored first; the first writer wins.
      if (!memo.has(name)) memo.set(name, value)
    }
    return memo.get(name) as T
  }

  function bound(scope: Scope): BoundPorts {
    return {
      ledger: {
        read: (thread) => enter(scope, () => readFacts(adapter, thread)),
        transact: (thread, decide) =>
          enter(scope, async () => {
            const { step, applied } = commit(adapter, thread, decide)
            for (const job of applied.jobs) startJob(job)
            // H1 coding-agent: the commit reserved the children; their sessions are built right after it.
            await Promise.all(
              applied.children.map((child) =>
                track(openNative(child)).catch((error: unknown) => {
                  // Never launched: drop it so it is no pending launch forever (D3).
                  conversations.delete(child.thread)
                  throw error
                })
              )
            )
            return { result: step.result, effects: step.effects, spawned: applied.spawned }
          }),
        modelContext: (thread) => enter(scope, () => modelContext(adapter, thread))
      },
      turns: {
        start: (thread, input, key) => enter(scope, () => startTurn(adapter, conversation(thread), input, key)),
        retract: (thread, key) => enter(scope, () => retract(conversation(thread), key)),
        stop: (thread) => enter(scope, () => stopRun(adapter, conversation(thread)))
      },
      helpers: {
        message: later('helpers.message'),
        awaitAnswer: later('helpers.awaitAnswer'),
        stop: later('helpers.stop')
      },
      waits: {
        // H5: inputs a failed run left do not hold `untilIdle`; neither wait resolves inside a run.
        untilIdle: (thread) =>
          enter(scope, () => {
            const conv = conversation(thread)
            return waitFor(conv, () => conv.active === undefined && conv.hostCompacts === 0 && piIdle(conv))
          }),
        untilRunEnd: (thread) =>
          enter(scope, () => {
            const conv = conversation(thread)
            return waitFor(conv, () => conv.active === undefined)
          })
      },
      memory: { remember: (name, produce) => enter(scope, () => remember(name, produce)) },
      clock
    }
  }
  async function withScope<T>(owner: Owner | undefined, body: (ports: BoundPorts) => Promise<T>): Promise<T> {
    const scope: Scope = { ended: false, owner }
    try {
      return await body(bound(scope))
    } finally {
      scope.ended = true
    }
  }
  function lifecycle(call: (handlers: LifecycleHandlers, ports: BoundPorts) => Promise<void>): Promise<void> {
    const handlers = installation.lifecycle
    return handlers ? withScope(undefined, (ports) => call(handlers, ports)) : Promise.resolve()
  }
  /** H4 coding-agent: an in-process promise per job, started from the next microtask. */
  function startJob(job: JobRecord): void {
    const scope: Scope = { ended: false }
    const run = async () => {
      try {
        await installation.jobs.get(job.spec.kind)!(bound(scope), job.spec)
        job.state = 'done'
      } catch (error) {
        report(error)
        job.state = 'failed'
      } finally {
        scope.ended = true
      }
    }
    void track(Promise.resolve().then(run))
  }
  async function openNative(conv: Conversation): Promise<void> {
    const child =
      conv.lineage.kind === 'subagent' ? { parent: conv.lineage.parent, origin: conv.lineage.origin } : undefined
    conv.native = await options.openSession({
      sessionManager: conv.manager,
      extension: conversationExtension(adapter, conv),
      ...(child && { child })
    })
  }

  const adapter: Adapter = {
    conversations,
    jobs,
    installation,
    gatePorts: { memory: { remember: (name, produce) => enter(installScope, () => remember(name, produce)) }, clock },
    conversation,
    track,
    report,
    withScope,
    lifecycle
  }

  options.install({
    ...bound(installScope),
    jobs: {
      register: (kind, handler) => {
        installation.jobs.set(kind, handler)
      }
    },
    tools: {
      register: (tool) => {
        installation.tools.set(tool.name, tool)
      }
    },
    toolGate: {
      register: (handlers) => {
        installation.gate = handlers
      }
    },
    contextFilter: {
      register: (handler) => {
        installation.filter = handler
      }
    },
    requestMeter: {
      register: (handler) => {
        installation.meter = handler
      }
    },
    lifecycle: {
      register: (handlers) => {
        installation.lifecycle = handlers
      }
    }
  })

  return {
    async openConversation(sessionManager) {
      if (closed) throw new Error('The coding-agent harness is closed')
      const thread = runtimeId<'thread'>(sessionManager.getSessionId())
      if (conversations.has(thread)) throw new Error(`Conversation ${thread} is already open`)
      // [plan choice] A stored session holds entries before it opens; a new one is empty.
      const conv = newConversation(
        thread,
        sessionManager,
        { kind: 'root' },
        undefined,
        sessionManager.getEntries().length > 0
      )
      conversations.set(thread, conv)
      await track(openNative(conv))
      // After Pi's session_start: `onOpen` may stop or start turns, which need the session.
      await lifecycle((handlers, ports) => handlers.onOpen(thread, { reopened: conv.reopened }, ports))
      return thread
    },
    withCall: (_thread, use) => withScope(undefined, use),
    async submitUser(thread, text) {
      if (closed) throw new Error('The coding-agent harness is closed')
      users += 1
      // A person's submissions get adapter-local keys; rules never see them.
      submit(adapter, conversation(thread), `user:${users}`, text)
    },
    compact: () => Promise.reject(new Error('compact is not implemented yet')),
    async settled() {
      do {
        await Promise.allSettled([...pending])
        await Promise.all([...conversations.values()].flatMap((conv) => conv.native?.session.waitForIdle() ?? []))
      } while (pending.size > 0)
    },
    async close() {
      if (closed) return
      const all = [...conversations.values()]
      // Every run first: a parent's tool call may be waiting on a foreground child.
      await Promise.all(all.flatMap((conv) => conv.native?.session.abort() ?? []))
      for (const conv of all) await conv.native?.dispose()
      closed = true
    }
  }
}
