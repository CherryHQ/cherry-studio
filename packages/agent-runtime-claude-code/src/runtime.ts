import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Observation, OperationResult, ShutdownReceipt, Subagent, Thread } from '@cherrystudio/agent-runtime'

import { isUuid, nativeIdentity, rejected, runtimeError } from './identity'
import { ClaudeOwner } from './owner'
import type { ClaudeProjection } from './projection'
import type {
  ClaudeCodeRuntime,
  ClaudeCodeRuntimeOptions,
  ClaudeObservationSink,
  ClaudeSessionOptions,
  ClaudeThreadHandle
} from './types'

export function createClaudeCodeRuntime(options: ClaudeCodeRuntimeOptions): ClaudeCodeRuntime {
  options = { ...options }
  if (!path.isAbsolute(options.configDir)) throw new TypeError('Claude configuration directory must be absolute')
  const owners = new Map<string, Promise<ClaudeOwner | undefined>>()
  const live = new Set<ClaudeOwner>()
  let closed = false
  const closingAccess = new AbortController()
  let shutdown: Promise<OperationResult<ShutdownReceipt>> | undefined
  const report = (error: unknown) => {
    try {
      options.onError?.(error)
    } catch {
      /* Diagnostics cannot affect execution. */
    }
  }
  const build = (config: ClaudeSessionOptions, sessionId: string, fresh: boolean) => {
    if (!path.isAbsolute(config.cwd)) throw new TypeError('Claude working directory must be absolute')
    const owner = new ClaudeOwner(
      options,
      { ...config, env: { ...(config.env ?? process.env) } },
      sessionId,
      fresh,
      report,
      (id) => {
        owners.set(id, Promise.resolve(owner))
      }
    )
    live.add(owner)
    return owner
  }
  const access = (
    owner: ClaudeOwner,
    projection: ClaudeProjection,
    sessionId: string,
    agentId?: string
  ): ClaudeThreadHandle => {
    let released = false
    const observations = new Set<Observation>()
    const observe = async (sink: ClaudeObservationSink): Promise<OperationResult<Observation>> => {
      if (released) return rejected('observe', 'released')
      try {
        const native = projection.feed.observe(sink)
        const observation = {
          drain: () => native.drain(),
          stop: async () => {
            await native.stop()
            observations.delete(observation)
          }
        }
        observations.add(observation)
        return { status: 'confirmed', value: observation }
      } catch {
        return rejected('observe', 'closed')
      }
    }
    const submit: ClaudeThreadHandle['claude']['submit'] = (inputId, content, whenBusy) =>
      released || agentId
        ? Promise.resolve({
            status: agentId ? 'unsupported' : 'rejected',
            inputId,
            error: runtimeError('submit', agentId ? 'child-input' : 'released')
          })
        : owner.submit(projection, inputId, content, whenBusy)
    return {
      thread: projection.thread,
      input: agentId
        ? undefined
        : { policies: ['steer', 'follow-up'], submit: (input) => submit(input.inputId, input.text, input.whenBusy) },
      interrupt: agentId
        ? undefined
        : () => (released ? Promise.resolve(rejected('interrupt', 'released')) : owner.interrupt(projection)),
      observe: (sink) =>
        observe(async (batch) => {
          for (const event of batch.events) await sink(event)
        }),
      claude: {
        state: () => ({ active: projection.control.isTurnActive, aborted: projection.control.sawAbortedMessage }),
        relation: () =>
          [...owner.projections.values()]
            .flatMap((parent) => parent.feed.snapshot.subagents ?? [])
            .find((relation) => relation.child?.id === projection.thread.id),
        async openChild(toolCallId, signal) {
          if (released || closed || signal?.aborted) return rejected('open-child', 'closed')
          const found = await new Promise<OperationResult<Subagent & { child: Thread }>>((resolve) => {
            const finish = (result: OperationResult<Subagent & { child: Thread }>) => {
              observations.delete(waiting)
              closingAccess.signal.removeEventListener('abort', close)
              signal?.removeEventListener('abort', close)
              void observed.stop()
              resolve(result)
            }
            const close = () => finish(rejected('open-child', 'closed'))
            const waiting: Observation = { drain: () => observed.drain(), stop: async () => close() }
            const observed = projection.feed.observe((batch) => {
              if (released || closed || batch.events.some((event) => event.type === 'closed')) return close()
              const snapshot = projection.feed.snapshot
              const matches = snapshot.subagents?.filter((child) => child.origin?.toolCallId === toolCallId) ?? []
              if (matches.length > 1) return finish(rejected('open-child', 'ambiguous-origin'))
              const relation = matches[0]
              if (relation?.child) return finish({ status: 'confirmed', value: { ...relation, child: relation.child } })
              const call = snapshot.messages
                .flatMap((message) => message.parts)
                .find(
                  (part) =>
                    part.type === 'dynamic-tool' &&
                    part.toolCallId === toolCallId &&
                    ['Agent', 'Task'].includes(part.toolName)
                )
              if (!call) return finish(rejected('open-child', 'unknown-call'))
              if (call.type === 'dynamic-tool' && call.state.startsWith('output-'))
                finish(rejected('open-child', 'child-unavailable'))
            })
            observations.add(waiting)
            closingAccess.signal.addEventListener('abort', close, { once: true })
            signal?.addEventListener('abort', close, { once: true })
          })
          if (found.status !== 'confirmed') return found
          const opened = await runtime.open(found.value.child)
          if (opened.status !== 'confirmed') return opened
          if (released || closed || signal?.aborted) {
            await opened.value.release()
            return rejected('open-child', 'closed')
          }
          return { status: 'confirmed', value: { relation: found.value, handle: opened.value } }
        },
        sessionId,
        agentId,
        start: (warm) =>
          released || agentId
            ? rejected('start', agentId ? 'child-control' : 'released')
            : owner.connect(projection, warm),
        supportedCommands: () =>
          released || agentId
            ? Promise.resolve(rejected('supportedCommands', agentId ? 'child-control' : 'released'))
            : owner.control(projection, 'supportedCommands', (query) => query.supportedCommands()),
        contextUsage: () =>
          released || agentId
            ? Promise.resolve(rejected('contextUsage', agentId ? 'child-control' : 'released'))
            : owner.control(projection, 'contextUsage', (query) => query.getContextUsage()),
        setPermissionMode: (mode) =>
          released || agentId
            ? Promise.resolve(rejected('setPermissionMode', agentId ? 'child-control' : 'released'))
            : owner.control(projection, 'setPermissionMode', (query) => query.setPermissionMode(mode)),
        submit,
        observe,
        archive: (options) =>
          released ? Promise.resolve(rejected('archive', 'released')) : owner.archive(projection, options?.refresh),
        stopTask: (id) => (released ? Promise.resolve(rejected('stopTask', 'released')) : owner.stopTask(id))
      },
      release: async () => {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      }
    }
  }
  const runtime: ClaudeCodeRuntime = {
    async create(config) {
      if (closed) return rejected('create', 'closed')
      try {
        const sessionId = config.sessionId ?? randomUUID()
        if (!isUuid(sessionId) || owners.has(sessionId)) return rejected('create', 'invalid-session-id')
        const owner = build(config, sessionId, true)
        owners.set(sessionId, Promise.resolve(owner))
        return { status: 'confirmed', value: access(owner, owner.projection(sessionId), sessionId) }
      } catch (error) {
        report(error)
        return rejected('create', 'invalid-configuration')
      }
    },
    async open(thread: Thread) {
      if (closed) return rejected('open', 'closed')
      if (thread.backendId !== options.backendId) return rejected('open', 'backend-mismatch')
      try {
        const { sessionId, agentId } = nativeIdentity(thread)
        let pending = owners.get(sessionId)
        if (!pending) {
          pending = (async () => {
            const config = await options.load?.({ backendId: thread.backendId, id: nativeIdentityRoot(thread) })
            if (!config || closed) return undefined
            const owner = build(config, sessionId, false)
            try {
              await owner.refresh(sessionId)
            } catch (error) {
              live.delete(owner)
              throw error
            }
            return owner
          })()
          owners.set(sessionId, pending)
        }
        let owner: ClaudeOwner | undefined
        try {
          owner = await pending
        } finally {
          if (!owner && owners.get(sessionId) === pending) owners.delete(sessionId)
        }
        if (closed) return rejected('open', 'closed')
        const projection = owner?.projections.get(thread.id)
        if (!owner || !projection) return rejected('open', 'native-storage-missing')
        return { status: 'confirmed', value: access(owner, projection, sessionId, agentId) }
      } catch (error) {
        report(error)
        return rejected('open', 'native-storage-unavailable')
      }
    },
    async settled() {
      if (!shutdown) {
        try {
          await Promise.all([...live].map((owner) => owner.settled()))
        } catch (cause) {
          if (!shutdown) throw cause
        }
      }
      if (shutdown) {
        const result = await shutdown
        if (result.status !== 'confirmed') throw new Error(result.error.message)
      }
    },
    shutdown() {
      closed = true
      closingAccess.abort()
      shutdown ??= (async () => {
        await Promise.allSettled(owners.values())
        const results = await Promise.all([...live].map((owner) => owner.shutdown()))
        const uncertain = results.find((result) => result.status !== 'confirmed')
        if (uncertain) {
          shutdown = undefined
          return uncertain
        }
        return { status: 'confirmed' as const, value: { effect: 'closed' as const } }
      })()
      return shutdown
    }
  }
  return runtime
}

function nativeIdentityRoot(thread: Thread): Thread['id'] {
  return thread.id.split('/')[0] as Thread['id']
}
