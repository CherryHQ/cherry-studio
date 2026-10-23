import { randomUUID } from 'node:crypto'

import {
  type AgentSession,
  type ContextUsage,
  type SessionEntry,
  type ToolDefinition,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent'

import {
  install,
  ENTRY_KINDS,
  type CallRef,
  type Entries,
  type HostPorts,
  type SubagentOrigin
} from '@cherrystudio/agent-behavior'
import {
  runtimeId,
  type AgentRuntime,
  type BackendId,
  type InputFact,
  type InputId,
  type ItemRef,
  type InterruptReceipt,
  type Observation,
  type OperationResult,
  type RuntimeError,
  type ThreadHandle,
  type ThreadInput,
  type Thread,
  type ShutdownReceipt,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { createPiBehavior, type PiBehavior } from './behavior/harness'
import { historyOf } from './behavior/history'
import { PiProjection } from './runtimeProjection'
import { createAgentRuntimeSession, type AgentRuntimeSession, type AgentRuntimeSessionOptions } from './session'
import type { SubagentSessionOptions } from './subagent'

export interface PiRuntimeBehavior {
  readonly host: HostPorts
  /** Native resources for the model selected by the behavior rules; called once per child context. */
  configureChild(child: {
    readonly thread: Thread
    readonly parent: Thread
    readonly origin: SubagentOrigin
  }): SubagentSessionOptions | Promise<SubagentSessionOptions>
}

export interface PiRuntimeOptions {
  backendId: BackendId
  /** Load the exact saved context and its configuration; undefined means not found. */
  load?: (ref: Thread) => Promise<PiSessionOptions | undefined>
  onError?: (error: unknown) => void
}
export type PiSessionOptions = AgentRuntimeSessionOptions & {
  /** Opt in during host migration; do not also install the legacy behavior extensions. */
  behavior?: PiRuntimeBehavior
}
export interface PiThreadHandle extends ThreadHandle {
  readonly input: ThreadInput
  readonly pi: {
    contextUsage(): ContextUsage | undefined
    history(): readonly SessionEntry[]
    toolDefinition(name: string): ToolDefinition | undefined
    toolCallId(ref: ItemRef | CallRef): string | undefined
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
  /** For a subagent's session: the session that runs it, whose controls stop it. */
  parentSession?: AgentRuntimeSession
  behavior?: { harness: PiBehavior; entries: Entries }
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
      pending: new Set(),
      messages: new Set()
    }
    live.add(entry)
    return entry
  }

  async function build(config: PiSessionOptions): Promise<OperationResult<Entry>> {
    try {
      if (config.behavior) return await buildBehavior(config, config.behavior)
      const subagents = config.subagents
      const childRelations: Entry[] = []
      let parent: Entry | undefined = undefined
      const publishChild = (child: Entry) =>
        parent?.projection.feed.publish({
          type: 'subagent.upsert',
          subagent: {
            id: runtimeId(child.ref.id),
            parent: parent.ref,
            child: child.ref
          }
        })
      const owner = await createAgentRuntimeSession({
        ...config,
        sessionManager: config.sessionManager,
        subagents: subagents && {
          ...subagents,
          configure: async (child) => {
            const configured = await subagents.configure(child)
            return {
              ...configured,
              onSessionCreated: (session: AgentSession) => {
                configured.onSessionCreated?.(session)
                const entry = attach(session)
                entry.parentSession = owner
                entries.set(session.sessionId, Promise.resolve({ status: 'confirmed', value: entry }))
                if (!parent) childRelations.push(entry)
                publishChild(entry)
              }
            }
          }
        },
        onEvent: (event) => {
          try {
            config.onEvent?.(event)
          } catch (cause) {
            report(cause)
          }
        }
      })
      parent = attach(owner.session, owner, Boolean(subagents))
      for (const child of childRelations) publishChild(child)
      return { status: 'confirmed', value: parent }
    } catch (cause) {
      report(cause)
      return rejected('open', 'native-error')
    }
  }

  async function buildBehavior(config: PiSessionOptions, behavior: PiRuntimeBehavior): Promise<OperationResult<Entry>> {
    if (config.subagents || config.offload || config.recall || config.compaction?.summarize)
      return rejected('open', 'conflicting-behavior')
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
      openSession: async ({ sessionManager, extension, summarize, child }) => {
        const configured = child
          ? await behavior.configureChild({
              thread: refFor(sessionManager.getSessionId()),
              parent: refFor(child.parent),
              origin: child.origin
            })
          : undefined
        const model = configured?.model ?? config.model
        if (child && `${model.provider}/${model.id}` !== child.origin.modelKey)
          throw new Error(`Child model does not match ${child.origin.modelKey}`)
        const settings = SettingsManager.inMemory(config.settings).getCompactionSettings(model)
        const native = await createAgentRuntimeSession({
          ...config,
          ...configured,
          model,
          sessionManager,
          settings: { ...config.settings, retry: { enabled: false }, cacheWarming: 'off' },
          compaction: { ...settings, ...config.compaction, summarize },
          extensionFactories: [...(configured?.extensionFactories ?? config.extensionFactories ?? []), extension],
          onEvent: (event) => {
            try {
              ;(child ? configured?.onEvent : config.onEvent)?.(event)
            } catch (cause) {
              report(cause)
            }
          }
        })
        try {
          configured?.onSessionCreated?.(native.session)
        } catch (cause) {
          await native.dispose().catch(report)
          throw cause
        }
        const entry = attach(native.session, child ? undefined : native, !child)
        entry.behavior = { harness, entries: installed }
        owned.push(entry)
        if (child) {
          entries.set(entry.ref.id, Promise.resolve({ status: 'confirmed', value: entry }))
          const parent = owned.find((candidate) => candidate.ref.id === child.parent)!
          parent.projection.feed.publish({
            type: 'subagent.upsert',
            subagent: { id: runtimeId(entry.ref.id), parent: parent.ref, child: entry.ref }
          })
        } else {
          const children = new Set(
            historyOf(sessionManager.getBranch(), entry.ref.id).flatMap((item) =>
              item.kind === 'record' && item.record.type === 'subagent-run' ? [item.record.value.sessionId] : []
            )
          )
          for (const childId of children)
            entry.projection.feed.publish({
              type: 'subagent.upsert',
              subagent: { id: runtimeId(childId), parent: entry.ref, child: refFor(childId) }
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
        entry.projection.close()
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
    return {
      thread: entry.ref,
      pi: {
        contextUsage: () => (unavailable() ? undefined : entry.session.getContextUsage()),
        history: () => (unavailable() ? [] : structuredClone(entry.session.sessionManager.getBranch())),
        toolDefinition: (name) => (unavailable() ? undefined : entry.session.getToolDefinition(name)),
        toolCallId: (ref) =>
          unavailable()
            ? undefined
            : 'key' in ref
              ? ref.thread === entry.ref.id
                ? entry.behavior?.harness.toolCallId(ref)
                : undefined
              : entry.projection.toolCallId(ref),
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
              if (entry.behavior) await entry.behavior.harness.compact(entry.ref.id, instructions)
              else await entry.owner.compact(instructions)
              if (entry.behavior && !compacted) return rejected('compact', 'declined')
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
          if (!entry.behavior) return { status: 'unsupported', error: error('permission-mode-changed', 'behavior') }
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
        policies: entry.owner ? ['reject', 'steer', 'follow-up'] : ['steer'],
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
                if (entry.behavior) {
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
                }
                const receipt = await entry.parentSession!.messageSubagent(entry.ref.id, input.text, {
                  inputId: input.inputId
                })
                const facts: InputFact[] = receipt.continued ? ['dispatch-started'] : ['queued']
                entry.projection.recordInput({ inputId: input.inputId, facts })
                return { status: 'acknowledged', inputId: input.inputId, facts }
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
              if (!entry.behavior) return entry.owner!.prompt(text, promptOptions)
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
          const pending = entry.messages.size > 0
          for (const controller of entry.messages) controller.abort()
          if (entry.behavior) {
            const { harness, entries } = entry.behavior
            await harness.withCall(entry.ref.id, async (ports) => {
              if (entry.owner) await entries.userStop(ports, entry.ref.id, randomUUID())
              else await entries.stopSubagent(ports, entry.ref.id, randomUUID())
            })
          } else if (entry.owner) await entry.owner.abort()
          else if (entry.parentSession) {
            // The user's stop of a subagent (background spec §9): a background run stops through its
            // parent; a foreground one is part of the parent's turn, which stops with it.
            if (entry.parentSession.stopSubagent(entry.ref.id))
              return { status: 'confirmed', value: { effect: 'requested' } }
            if (entry.session.isStreaming) await entry.parentSession.abort()
          } else await entry.session.abort()
          return { status: 'confirmed', value: { effect: pending ? 'requested' : 'native-scope-idle' } }
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
          for (const entry of live) for (const controller of entry.messages) controller.abort()
          await Promise.all([...live].map((entry) => entry.admission))
          await Promise.all(
            owners.map((entry) => (entry.behavior ? entry.behavior.harness.close() : entry.session.abort()))
          )
          await Promise.all(owners.flatMap((entry) => [...entry.pending]))
          await Promise.all(owners.filter((entry) => !entry.behavior).map((entry) => entry.owner!.dispose()))
          for (const entry of live) entry.projection.close()
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
