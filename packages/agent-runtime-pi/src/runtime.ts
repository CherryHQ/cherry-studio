import { randomUUID } from 'node:crypto'

import {
  type AgentSession,
  type SessionEntry,
  type ToolDefinition,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'

import { install, ENTRY_KINDS, type CallRef, type Entries, type HostPorts } from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type AgentRuntime,
  type BackendId,
  type InputFact,
  type InputId,
  type Observation,
  type OperationResult,
  type RuntimeError,
  type ThreadHandle,
  type ThreadInput,
  type Thread,
  type Subagent,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { createPiBehavior, type PiBehavior } from './behavior/harness'
import { historyOf } from './behavior/history'
import { readContextUsage } from './contextUsage'
import { PiProjection, type PiObservation } from './runtimeProjection'
import { createAgentRuntimeSession, type AgentRuntimeSession, type AgentRuntimeSessionOptions } from './session'

export interface PiRuntimeBehavior {
  readonly host: HostPorts
  /** Native resources for the model selected by the behavior rules; called once per child context. */
  configureChild(child: {
    readonly thread: Thread
    readonly modelKey: string
  }):
    | Partial<Pick<AgentRuntimeSessionOptions, 'model' | 'modelRuntime' | 'compaction'>>
    | Promise<Partial<Pick<AgentRuntimeSessionOptions, 'model' | 'modelRuntime' | 'compaction'>>>
}

export interface PiRuntimeOptions {
  backendId: BackendId
  /** Load the exact saved context and its configuration; undefined means not found. */
  load?: (ref: Thread) => Promise<PiSessionOptions | undefined>
  onError?: (error: unknown) => void
}
export type PiSessionOptions = Omit<AgentRuntimeSessionOptions, 'compaction'> & {
  behavior: PiRuntimeBehavior
  compaction?: Omit<NonNullable<AgentRuntimeSessionOptions['compaction']>, 'summarize'>
}
export interface PiThreadHandle extends ThreadHandle {
  readonly input: ThreadInput
  readonly pi: {
    observe(sink: (batch: PiObservation) => void | Promise<void>): Promise<OperationResult<Observation>>
    relation(): Subagent | undefined
    openChild(
      toolCallId: string,
      signal?: AbortSignal
    ): Promise<
      OperationResult<{
        readonly relation: Subagent & { readonly child: Thread }
        readonly handle: PiThreadHandle
      }>
    >
    history(): readonly SessionEntry[]
    /** Read committed entries through owner shutdown, until this access is released. */
    archive(): ReturnType<PiProjection['archive']>
    /** Wait for native work, including the shared behavior's owned children and reporting jobs. */
    settled(): Promise<void>
    toolDefinition(name: string): ToolDefinition | undefined
    toolCallId(ref: CallRef): string | undefined
    cancelQueuedInputs(): OperationResult<readonly InputId[]>
    compact(instructions?: string): Promise<OperationResult<void>>
    permissionModeChanged(): Promise<OperationResult<void>>
  }
}
export interface PiRuntime extends AgentRuntime {
  create(options: PiSessionOptions): Promise<OperationResult<PiThreadHandle>>
  open(ref: Thread): Promise<OperationResult<PiThreadHandle>>
}
interface Entry {
  ref: Thread
  projection: PiProjection
  session: AgentSession
  owner?: AgentRuntimeSession
  behavior: { harness: PiBehavior; entries: Entries }
  admission: Promise<void>
  pending: Set<Promise<void>>
  readonly messages: Set<AbortController>
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
  const closingAccess = new AbortController()
  let shutdown: Promise<OperationResult<void>> | undefined
  const report = (cause: unknown) => {
    try {
      options.onError?.(cause)
    } catch {
      /* Diagnostics cannot alter native work. */
    }
  }
  const refFor = (id: string): Thread => Object.freeze({ backendId: options.backendId, id: runtimeId<'thread'>(id) })

  function attach(
    session: AgentSession,
    behavior: Entry['behavior'],
    owner?: AgentRuntimeSession,
    children = false
  ): Entry {
    const existing = [...live].find((entry) => entry.ref.id === session.sessionId)
    if (existing) {
      existing.session = session
      existing.behavior = behavior
      existing.projection.rebind(session)
      return existing
    }
    const entry: Entry = {
      ref: refFor(session.sessionId),
      session,
      owner,
      behavior,
      projection: new PiProjection(refFor(session.sessionId), session, report, children),
      admission: Promise.resolve(),
      pending: new Set(),
      messages: new Set()
    }
    live.add(entry)
    return entry
  }

  async function build(config: PiSessionOptions): Promise<OperationResult<Entry>> {
    try {
      return await buildBehavior(config, config.behavior)
    } catch (cause) {
      report(cause)
      return rejected('open', 'native-error')
    }
  }

  async function buildBehavior(config: PiSessionOptions, behavior: PiRuntimeBehavior): Promise<OperationResult<Entry>> {
    if (
      config
        .sessionManager!.getBranch()
        .some((entry) => entry.type === 'custom' && entry.customType === ENTRY_KINDS.subagentOrigin)
    )
      return rejected('open', 'child-owner-unavailable')
    let installed!: Entries
    const owned: Entry[] = []
    const harness = createPiBehavior({
      install: (ports) => {
        installed = install(ports, behavior.host).entries
      },
      onError: report,
      onResults: (thread, result) => owned.find((entry) => entry.ref.id === thread)?.projection.results(result),
      openSession: async ({ sessionManager, extension, summarize, child }) => {
        const parent = child && owned.find((entry) => entry.ref.id === child.parent)
        const nativeCallId =
          parent &&
          historyOf(parent.session.sessionManager.getBranch(), parent.ref.id)
            .flatMap((item) => (item.kind === 'assistant' ? item.toolCalls : []))
            .find((call) => call.callKey === child.origin.parentToolCallId)?.callId
        if (child && !nativeCallId) throw new Error('Child origin has no native parent call')
        const configured = child
          ? await behavior.configureChild({
              thread: refFor(sessionManager.getSessionId()),
              modelKey: child.origin.modelKey
            })
          : undefined
        const model = configured?.model ?? config.model
        if (child && `${model.provider}/${model.id}` !== child.origin.modelKey)
          throw new Error(`Child model does not match ${child.origin.modelKey}`)
        const settings = SettingsManager.inMemory(config.settings).getCompactionSettings(model)
        let entry!: Entry
        const native = await createAgentRuntimeSession(
          {
            ...config,
            ...configured,
            model,
            sessionManager,
            settings: { ...config.settings, retry: { enabled: false }, cacheWarming: 'off' },
            compaction: { ...settings, ...config.compaction, ...configured?.compaction, summarize },
            extensionFactories: [...(config.extensionFactories ?? []), extension],
            onEvent: (event) => {
              try {
                if (!child) config.onEvent?.(event)
              } catch (cause) {
                report(cause)
              }
            }
          },
          (session) => {
            entry = attach(session, { harness, entries: installed }, undefined, !child)
            owned.push(entry)
          }
        )
        entry.owner = child ? undefined : native
        if (child) {
          entries.set(entry.ref.id, Promise.resolve({ status: 'confirmed', value: entry }))
          const parent = owned.find((candidate) => candidate.ref.id === child.parent)!
          parent.projection.feed.publish({
            type: 'subagent.upsert',
            subagent: {
              id: runtimeId(entry.ref.id),
              parent: parent.ref,
              child: entry.ref,
              origin: { toolCallId: nativeCallId!, description: child.origin.description }
            }
          })
        } else {
          const history = historyOf(sessionManager.getBranch(), entry.ref.id)
          const children = new Map<string, Subagent>()
          const calls = history.flatMap((item) => (item.kind === 'assistant' ? item.toolCalls : []))
          for (const item of history) {
            if (item.kind !== 'record' || item.record.type !== 'subagent-run') continue
            const record = item.record.value
            if (children.has(record.sessionId)) continue
            const call = calls.find((call) => call.callKey === record.parentToolCallId)
            children.set(record.sessionId, {
              id: runtimeId(record.sessionId),
              parent: entry.ref,
              child: refFor(record.sessionId),
              ...(call && { origin: { toolCallId: call.callId, description: record.description } })
            })
          }
          for (const subagent of children.values())
            entry.projection.feed.publish({
              type: 'subagent.upsert',
              subagent
            })
        }
        return native
      }
    })
    try {
      const thread = await harness.openConversation(config.sessionManager!)
      return { status: 'confirmed', value: owned.find((entry) => entry.ref.id === thread)! }
    } catch (cause) {
      await harness.close().catch(report)
      for (const entry of owned) {
        await entry.projection.close()
        entries.delete(entry.ref.id)
        live.delete(entry)
      }
      throw cause
    }
  }

  function access(entry: Entry): PiThreadHandle {
    let released = false
    const observations = new Set<Observation>()
    const unavailable = () => released || closing
    const observeCaptured = async (subscribe: () => Observation): Promise<OperationResult<Observation>> => {
      if (unavailable()) return rejected('observe', 'closed')
      const observed = subscribe()
      const observation: Observation = {
        drain: () => observed.drain(),
        stop: async () => {
          observations.delete(observation)
          await observed.stop()
        }
      }
      observations.add(observation)
      return { status: 'confirmed', value: observation }
    }
    return {
      thread: entry.ref,
      async contextUsage() {
        if (unavailable()) return rejected('contextUsage', 'released')
        const result = readContextUsage(entry.session)
        entry.projection.feed.publish({ type: 'context.changed', result })
        return result
      },
      pi: {
        observe: (sink) => observeCaptured(() => entry.projection.observe(sink)),
        relation: () =>
          [...live]
            .flatMap((parent) => parent.projection.feed.snapshot.subagents ?? [])
            .find((relation) => relation.child?.id === entry.ref.id),
        async openChild(toolCallId, signal) {
          if (unavailable() || signal?.aborted) return rejected('open-child', 'closed')
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
            const observed = entry.projection.feed.observe((event) => {
              if (unavailable() || event.type === 'closed') return close()
              const matches =
                entry.projection.feed.snapshot.subagents?.filter((child) => child.origin?.toolCallId === toolCallId) ??
                []
              if (matches.length > 1) return finish(rejected('open-child', 'ambiguous-origin'))
              const relation = matches[0]
              if (relation?.child) return finish({ status: 'confirmed', value: { ...relation, child: relation.child } })
              const history = historyOf(entry.session.sessionManager.getBranch(), entry.ref.id)
              const call = history
                .flatMap((item) => (item.kind === 'assistant' ? item.toolCalls : []))
                .find((call) => call.callId === toolCallId && call.name === 'subagent')
              if (!call) return finish(rejected('open-child', 'unknown-call'))
              if (history.some((item) => item.kind === 'tool-result' && item.callId === toolCallId))
                finish(rejected('open-child', 'child-unavailable'))
            })
            observations.add(waiting)
            closingAccess.signal.addEventListener('abort', close, { once: true })
            signal?.addEventListener('abort', close, { once: true })
          })
          if (found.status !== 'confirmed') return found
          const opened = await runtime.open(found.value.child)
          if (opened.status !== 'confirmed') return opened
          if (unavailable() || signal?.aborted) {
            await opened.value.release()
            return rejected('open-child', 'closed')
          }
          return { status: 'confirmed', value: { relation: found.value, handle: opened.value } }
        },
        history: () => (unavailable() ? [] : structuredClone(entry.session.sessionManager.getBranch())),
        archive: () => {
          if (released) throw new Error('Pi history access is closed')
          return structuredClone(entry.projection.archive())
        },
        async settled() {
          await entry.admission
          await entry.behavior.harness.settled()
          await Promise.allSettled([...entry.pending])
          await entry.session.waitForIdle()
        },
        toolDefinition: (name) => (unavailable() ? undefined : entry.session.getToolDefinition(name)),
        toolCallId: (ref) =>
          !unavailable() && ref.thread === entry.ref.id ? entry.behavior.harness.toolCallId(ref) : undefined,
        cancelQueuedInputs() {
          if (unavailable()) return rejected('cancel-queued-inputs', 'closed')
          if (!entry.owner) return rejected('cancel-queued-inputs', 'not-owner')
          const ids = entry.projection.feed.snapshot.inputs.flatMap((input) =>
            input.inputId && input.facts.includes('queued') && !input.facts.includes('placed') && !input.outcome
              ? [input.inputId]
              : []
          )
          entry.session.clearQueue()
          for (const inputId of ids) entry.projection.recordInput({ inputId, facts: [], outcome: 'aborted' })
          return { status: 'confirmed', value: ids }
        },
        compact(instructions) {
          const work = entry.admission.then(async (): Promise<OperationResult<void>> => {
            if (unavailable()) return rejected('compact', 'closed')
            if (!entry.owner) return rejected('compact', 'not-owner')
            if (entry.session.isStreaming) return rejected('compact', 'busy')
            let compacted = false
            const unsubscribe = entry.session.subscribe((event) => {
              if (event.type === 'compaction_end' && event.reason === 'manual') compacted = event.result !== undefined
            })
            try {
              await entry.behavior.harness.compact(entry.ref.id, instructions)
              if (!compacted) return rejected('compact', 'declined')
              return { status: 'confirmed', value: undefined }
            } catch (cause) {
              report(cause)
              return { status: 'unknown', error: error('compact', 'native-error') }
            } finally {
              unsubscribe()
            }
          })
          entry.admission = work.then(() => {})
          return work
        },
        async permissionModeChanged() {
          if (unavailable()) return rejected('permission-mode-changed', 'closed')
          try {
            const { harness, entries } = entry.behavior
            await harness.withCall(entry.ref.id, (ports) => entries.permissionModeChanged(ports, entry.ref.id))
            return { status: 'confirmed', value: undefined }
          } catch (cause) {
            report(cause)
            return { status: 'unknown', error: error('permission-mode-changed', 'native-error') }
          }
        }
      },
      input: {
        submit(input): Promise<SubmitResult> {
          if (unavailable()) return Promise.resolve({ ...rejected('submit', 'closed'), inputId: input.inputId })
          if (!entry.owner) {
            if (input.whenBusy !== 'steer')
              return Promise.resolve({
                status: 'unsupported',
                inputId: input.inputId,
                error: error('submit', 'policy')
              })
            const attempt = entry.admission.then(async (): Promise<SubmitResult> => {
              if (unavailable()) return { ...rejected('submit', 'closed'), inputId: input.inputId }
              try {
                const controller = new AbortController()
                entry.messages.add(controller)
                try {
                  const { harness, entries } = entry.behavior
                  const receipt = await harness.withCall(
                    entry.ref.id,
                    (ports) =>
                      entries.messageSubagent(ports, entry.ref.id, input.text, randomUUID(), controller.signal),
                    { inputId: input.inputId, signal: controller.signal }
                  )
                  if (receipt.status === 'refused')
                    return {
                      status: 'rejected',
                      inputId: input.inputId,
                      error: { operation: 'submit', code: 'behavior-refused', message: receipt.reason }
                    }
                  const facts: InputFact[] = receipt.status === 'continued' ? ['dispatch-started'] : ['queued']
                  entry.projection.recordInput({ inputId: input.inputId, facts })
                  return { status: 'acknowledged', inputId: input.inputId, facts }
                } finally {
                  entry.messages.delete(controller)
                }
              } catch (cause) {
                report(cause)
                return { status: 'unknown', inputId: input.inputId, error: error('submit', 'native-error') }
              }
            })
            entry.admission = attempt.then(() => {})
            return attempt
          }
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
            const prompt = async (text: string, promptOptions: Parameters<AgentRuntimeSession['prompt']>[1]) => {
              const { harness, entries } = entry.behavior
              if (/^\/goal(?:\s|$)/.test(text)) {
                await harness.withCall(entry.ref.id, (ports) =>
                  entries.goalCommand(ports, entry.ref.id, text.slice('/goal'.length).trim(), randomUUID())
                )
                promptOptions?.preflightResult?.('handled')
                return
              }
              const controller = new AbortController()
              entry.messages.add(controller)
              try {
                await harness.prompt(
                  entry.ref.id,
                  text,
                  {
                    ...promptOptions,
                    preflightResult: (disposition) => {
                      entry.messages.delete(controller)
                      promptOptions?.preflightResult?.(disposition)
                    }
                  },
                  controller.signal
                )
              } finally {
                entry.messages.delete(controller)
              }
            }
            const completion = prompt(input.text, {
              inputId: input.inputId,
              ...(input.whenBusy !== 'reject' && {
                streamingBehavior: input.whenBusy === 'follow-up' ? 'followUp' : 'steer'
              }),
              preflightResult: (disposition) => {
                if (disposition === 'handled') entry.session.sessionManager.flush()
                acknowledged = true
                const facts: InputFact[] = [
                  disposition === 'started'
                    ? 'dispatch-started'
                    : disposition === 'handled'
                      ? 'locally-handled'
                      : 'queued'
                ]
                entry.projection.recordInput({ inputId: input.inputId, facts })
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
        }
      },
      observe: (sink) => observeCaptured(() => entry.projection.feed.observe(sink)),
      async interrupt(): Promise<OperationResult<void>> {
        if (unavailable()) return rejected('interrupt', 'closed')
        try {
          for (const controller of entry.messages) controller.abort()
          entry.session.abortCompaction()
          const { harness, entries } = entry.behavior
          await harness.withCall(entry.ref.id, async (ports) => {
            if (entry.owner) await entries.userStop(ports, entry.ref.id, randomUUID())
            else await entries.stopSubagent(ports, entry.ref.id, randomUUID())
          })
          return { status: 'confirmed', value: undefined }
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
      closingAccess.abort()
      shutdown ??= (async () => {
        try {
          await Promise.all(entries.values())
          const owners = [...live].filter((entry) => entry.owner)
          for (const entry of live) {
            for (const controller of entry.messages) controller.abort()
            entry.session.abortCompaction()
          }
          await Promise.all([...live].map((entry) => entry.admission))
          await Promise.all(owners.map((entry) => entry.behavior.harness.close()))
          await Promise.all(owners.flatMap((entry) => [...entry.pending]))
          for (const entry of live) await entry.projection.close()
          return { status: 'confirmed' as const, value: undefined }
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
