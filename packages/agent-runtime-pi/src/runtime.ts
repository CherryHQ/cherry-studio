import { type AgentSession, SessionManager } from '@earendil-works/pi-coding-agent'

import {
  runtimeId,
  type AgentRuntime,
  type BackendId,
  type InputFact,
  type InterruptReceipt,
  type Observation,
  type OperationResult,
  type RuntimeError,
  type ThreadHandle,
  type Thread,
  type ShutdownReceipt,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { PiProjection } from './runtimeProjection'
import { createAgentRuntimeSession, type AgentRuntimeSession, type AgentRuntimeSessionOptions } from './session'

export interface PiRuntimeOptions {
  backendId: BackendId
  /** Load the exact saved context and its configuration; undefined means not found. */
  load?: (ref: Thread) => Promise<AgentRuntimeSessionOptions | undefined>
  onError?: (error: unknown) => void
}
export type PiSessionOptions = AgentRuntimeSessionOptions
export interface PiRuntime extends AgentRuntime {
  create(options: PiSessionOptions): Promise<OperationResult<ThreadHandle>>
}
interface Entry {
  ref: Thread
  projection: PiProjection
  session: AgentSession
  owner?: AgentRuntimeSession
  admission: Promise<void>
  pending: Set<Promise<void>>
}
const error = (operation: string, code: string): RuntimeError => ({
  operation,
  code,
  message: `Pi ${operation}: ${code}`
})
const rejected = (operation: string, code: string) => ({ status: 'rejected' as const, error: error(operation, code) })

export async function createPiRuntime(options: PiRuntimeOptions): Promise<OperationResult<PiRuntime>> {
  const entries = new Map<string, Promise<OperationResult<Entry>>>()
  const live = new Set<Entry>()
  let closing = false
  let shutdown: Promise<OperationResult<ShutdownReceipt>> | undefined
  const report = (cause: unknown) => {
    try {
      options.onError?.(cause)
    } catch {
      /* Diagnostics cannot alter native work. */
    }
  }
  const refFor = (id: string): Thread => Object.freeze({ backendId: options.backendId, id: runtimeId<'thread'>(id) })

  function attach(session: AgentSession, owner?: AgentRuntimeSession, children = false): Entry {
    const existing = [...live].find((entry) => entry.ref.id === session.sessionId)
    if (existing) {
      existing.session = session
      existing.projection.rebind(session)
      return existing
    }
    const entry: Entry = {
      ref: refFor(session.sessionId),
      session,
      owner,
      projection: new PiProjection(refFor(session.sessionId), session, report, children),
      admission: Promise.resolve(),
      pending: new Set()
    }
    live.add(entry)
    return entry
  }

  async function build(config: PiSessionOptions): Promise<OperationResult<Entry>> {
    let entry: Entry | undefined
    try {
      const owner = await createAgentRuntimeSession(config, (session) => {
        entry = attach(session)
      })
      entry!.owner = owner
      return { status: 'confirmed', value: entry! }
    } catch (cause) {
      if (entry) {
        live.delete(entry)
        await entry.projection.close()
      }
      report(cause)
      return rejected('open', 'native-error')
    }
  }

  function access(entry: Entry): ThreadHandle {
    let released = false
    const observations = new Set<Observation>()
    const unavailable = () => released || closing
    return {
      thread: entry.ref,
      inputPolicies: entry.owner ? ['reject', 'steer', 'follow-up'] : [],
      submit(input): Promise<SubmitResult> {
        if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
        if (!entry.owner)
          return Promise.resolve({
            status: 'unsupported',
            inputId: input.inputId,
            error: error('submit', 'managed-child')
          })
        if (!['reject', 'steer', 'follow-up'].includes(input.whenBusy))
          return Promise.resolve({ status: 'unsupported', inputId: input.inputId, error: error('submit', 'policy') })
        let resolve!: (value: SubmitResult) => void
        const result = new Promise<SubmitResult>((done) => {
          resolve = done
        })
        const attempt = entry.admission.then(async () => {
          if (unavailable()) {
            resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
            return
          }
          let acknowledged = false
          let release!: () => void
          const admission = new Promise<void>((done) => {
            release = done
          })
          const completion = entry
            .owner!.prompt(input.text, {
              ...(input.whenBusy !== 'reject' && {
                streamingBehavior: input.whenBusy === 'follow-up' ? 'followUp' : 'steer'
              }),
              preflightResult: (disposition) => {
                acknowledged = true
                const facts: InputFact[] = [
                  disposition === 'started'
                    ? 'dispatch-started'
                    : disposition === 'handled'
                      ? 'locally-handled'
                      : 'queued'
                ]
                entry.projection.feed.publish({ type: 'input.changed', input: { inputId: input.inputId, facts } })
                resolve({ status: 'acknowledged', inputId: input.inputId, facts })
                release()
              }
            })
            .then(
              () => {
                if (!acknowledged)
                  resolve({ status: 'unknown', inputId: input.inputId, error: error('submit', 'missing-receipt') })
              },
              (cause) => {
                report(cause)
                if (!acknowledged) {
                  const busy =
                    cause instanceof Error &&
                    cause.message ===
                      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
                  resolve({
                    status: busy ? 'rejected' : 'unknown',
                    error: error('submit', busy ? 'busy' : 'native-error'),
                    inputId: input.inputId
                  })
                } else entry.projection.feed.publish({ type: 'diagnostic', error: error('submit', 'native-error') })
              }
            )
            .finally(() => {
              release()
              entry.pending.delete(completion)
            })
          entry.pending.add(completion)
          await admission
        })
        entry.admission = attempt.catch(report)
        return result
      },
      async observe(sink) {
        if (unavailable()) return rejected('observe', 'closed')
        const observed = entry.projection.feed.observe(sink)
        const observation = {
          stop: async () => {
            observations.delete(observation)
            await observed.stop()
          }
        }
        observations.add(observation)
        return { status: 'confirmed', value: observation }
      },
      async interrupt(): Promise<OperationResult<InterruptReceipt>> {
        if (unavailable()) return rejected('interrupt', 'closed')
        try {
          await (entry.owner ? entry.owner.abort() : entry.session.abort())
          return { status: 'confirmed', value: { effect: 'native-scope-idle' } }
        } catch (cause) {
          report(cause)
          return { status: 'unknown', error: error('interrupt', 'native-error') }
        }
      },
      async release() {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      }
    }
  }

  const runtime: PiRuntime = {
    async create(config) {
      if (closing) return rejected('create', 'closed')
      const manager = config.sessionManager ?? SessionManager.inMemory(config.cwd)
      const id = manager.getSessionId()
      if (entries.has(id)) return rejected('create', 'already-exists')
      const loading = build({ ...config, sessionManager: manager })
      entries.set(id, loading)
      const built = await loading
      if (built.status !== 'confirmed') {
        entries.delete(id)
        return built
      }
      return closing ? rejected('create', 'closed') : { status: 'confirmed', value: access(built.value) }
    },
    async open(ref) {
      if (closing) return rejected('open', 'closed')
      if (ref.backendId !== options.backendId) return rejected('open', 'not-found')
      let loading = entries.get(ref.id)
      if (!loading) {
        loading = (async () => {
          try {
            const config = await options.load?.(ref)
            if (!config) return rejected('open', 'not-found')
            if (config.sessionManager?.getSessionId() !== ref.id) return rejected('open', 'identity-mismatch')
            return build(config)
          } catch (cause) {
            report(cause)
            return rejected('open', 'native-error')
          }
        })()
        entries.set(ref.id, loading)
      }
      const loaded = await loading
      if (loaded.status !== 'confirmed') {
        if (entries.get(ref.id) === loading) entries.delete(ref.id)
        return loaded
      }
      return closing ? rejected('open', 'closed') : { status: 'confirmed', value: access(loaded.value) }
    },
    shutdown() {
      closing = true
      shutdown ??= (async () => {
        try {
          await Promise.all(entries.values())
          const owners = [...live].filter((entry) => entry.owner)
          await Promise.all(owners.map((entry) => entry.admission))
          await Promise.all(owners.map((entry) => entry.session.abort()))
          await Promise.all(owners.flatMap((entry) => [...entry.pending]))
          await Promise.all(owners.map((entry) => entry.owner!.dispose()))
          for (const entry of live) await entry.projection.close()
          return { status: 'confirmed' as const, value: { effect: 'closed' as const } }
        } catch (cause) {
          report(cause)
          return { status: 'unknown' as const, error: error('shutdown', 'native-error') }
        }
      })()
      return shutdown
    }
  }
  return { status: 'confirmed', value: runtime }
}
