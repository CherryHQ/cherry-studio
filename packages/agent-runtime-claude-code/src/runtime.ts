import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import type {
  InputDraft,
  InputId,
  ThreadInput,
  SubmitResult,
  Observation,
  OperationResult,
  Subagent,
  Thread
} from '@cherrystudio/agent-runtime'

import { isUuid, nativeIdentity, rejected, runtimeError } from './identity'
import { ClaudeOwner } from './owner'
import type { ClaudeProjection } from './projection'
import type {
  ClaudeInput,
  ClaudeCodeRuntime,
  ClaudeCodeRuntimeOptions,
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
  let shutdown: Promise<OperationResult<void>> | undefined
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
    const control = <T>(operation: string, invoke: (query: Query) => Promise<T>): Promise<OperationResult<T>> =>
      released || agentId
        ? Promise.resolve(rejected(operation, agentId ? 'child-control' : 'released'))
        : owner.control(projection, operation, invoke)

    const observe: ClaudeThreadHandle['claude']['observe'] = async (sink, needsRecovery) => {
      if (released) return rejected('observe', 'released')
      try {
        const native = projection.feed.observe(sink, needsRecovery)
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
    function bindInput<D extends { inputId: InputId }>(
      content: (draft: D) => SDKUserMessage['message']['content']
    ): ThreadInput<D> | undefined {
      if (agentId) return undefined
      const send = (draft: D, priority: 'steer' | 'follow-up'): Promise<SubmitResult> =>
        released
          ? Promise.resolve({ status: 'rejected', inputId: draft.inputId, error: runtimeError('submit', 'released') })
          : owner.submit(projection, draft.inputId, content(draft), priority)
      return {
        steer: { whenIdle: 'may-start', submit: (draft) => send(draft, 'steer') },
        followUp: { persistence: 'volatile', submit: (draft) => send(draft, 'follow-up') }
      }
    }
    return {
      thread: projection.thread,
      compact: agentId
        ? undefined
        : async (instructions) =>
            released ? rejected('compact', 'released') : owner.compact(projection, instructions),
      contextUsage: async () => {
        if (released) return rejected('contextUsage', 'released')
        if (agentId) return { status: 'unsupported', error: runtimeError('contextUsage', 'child-control') }
        const result = await owner.contextUsage(projection)
        return released ? rejected('contextUsage', 'released') : result
      },
      input: bindInput<InputDraft>((draft) => draft.text),
      interrupt: agentId
        ? undefined
        : () => (released ? Promise.resolve(rejected('interrupt', 'released')) : owner.interrupt(projection)),
      observe: (sink) =>
        observe(async (batch) => {
          for (const event of batch.events) await sink(event)
        }),
      claude: {
        state: () => ({ active: projection.control.isTurnActive }),
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
        start: (warm) =>
          released || agentId
            ? rejected('start', agentId ? 'child-control' : 'released')
            : owner.connect(projection, warm),
        supportedCommands: () => control('supportedCommands', (query) => query.supportedCommands()),
        supportedModels: () => control('supportedModels', (query) => query.supportedModels()),
        setEffort: (effort) => control('setEffort', (query) => query.applyFlagSettings({ effortLevel: effort })),
        setPermissionMode: (mode) => control('setPermissionMode', (query) => query.setPermissionMode(mode)),
        input: bindInput<ClaudeInput>((draft) => draft.content),
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
    async lookupInput(thread, inputId) {
      if (closed || thread.backendId !== options.backendId) return undefined
      const { sessionId } = nativeIdentity(thread)
      return (await owners.get(sessionId))?.lookupInput(thread, inputId)
    },
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
              if (!(await owner.refresh(sessionId))) {
                live.delete(owner)
                return undefined
              }
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
        return { status: 'confirmed' as const, value: undefined }
      })()
      return shutdown
    }
  }
  return runtime
}

function nativeIdentityRoot(thread: Thread): Thread['id'] {
  return thread.id.split('/')[0] as Thread['id']
}
