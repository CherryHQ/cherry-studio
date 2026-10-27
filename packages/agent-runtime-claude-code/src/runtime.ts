import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Observation, OperationResult, ShutdownReceipt, Thread } from '@cherrystudio/agent-runtime'

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
        archive: () => (released ? Promise.resolve(rejected('archive', 'released')) : owner.archive(projection)),
        stopTask: (id) => (released ? Promise.resolve(rejected('stopTask', 'released')) : owner.stopTask(id))
      },
      release: async () => {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      }
    }
  }
  return {
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
        const owner = await pending
        if (closed) return rejected('open', 'closed')
        const projection = owner?.projections.get(thread.id)
        if (!owner || !projection) return rejected('open', 'native-storage-missing')
        return { status: 'confirmed', value: access(owner, projection, sessionId, agentId) }
      } catch (error) {
        report(error)
        return rejected('open', 'native-storage-unavailable')
      }
    },
    shutdown() {
      closed = true
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
}

function nativeIdentityRoot(thread: Thread): Thread['id'] {
  return thread.id.split('/')[0] as Thread['id']
}
