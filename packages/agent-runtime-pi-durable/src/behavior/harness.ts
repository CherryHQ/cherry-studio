import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal, type Context } from '@earendil-works/chord/context'
import { copyJson, type JsonRepresentation, type JsonValue as NativeJson } from '@earendil-works/chord/json'
import {
  CompactionEntry,
  configure,
  ConversationBusy,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  hook,
  InboxDoc,
  LiveDoc,
  ToolResultEntry,
  ToolTask,
  ProviderDoc,
  type AgentChange,
  type EntryRecord,
  type Extension,
  type Harness,
  type TaskId,
  type Tx,
  type HookApi,
  CompactionTask
} from '@earendil-works/pi-durable'

import {
  allowRequest,
  admitRound,
  askUserResult,
  decideAskUser,
  decideCreateGoal,
  decideGetGoal,
  decideMessage,
  decideMessageStarted,
  decideSpawn,
  decideSteerWithdrawn,
  decideStop,
  decideTodos,
  decideUpdateGoal,
  fieldsOf,
  goalToolSpecs,
  interactionToolSpecs,
  messageToolResult,
  modelFacts,
  notDeliveredText,
  reasonOf,
  recallText,
  recallToolSpec,
  startedText,
  stoppedResult,
  stringField,
  subagentToolSpecs,
  unverifiedText,
  type SubagentMessageReceipt,
  type GateCall,
  type GateFacts,
  type GateVerdict,
  type RequestAllowance,
  type ToolSpec,
  type ToolCall,
  type ToolOutcome,
  decideAtIdle,
  decideGoalCommand,
  decideOnOpen,
  decidePermissionModeChanged,
  decideRoundWithdrawn,
  decideRunEnd,
  decideSpawnAbandoned,
  decideStopSubagent,
  decideUserStop,
  ensureDriver,
  keys,
  readSubagents,
  reportTarget,
  runReport,
  runStopping,
  settingsSnapshot,
  storeChildReport,
  subagentViews,
  turnInput,
  TURN_STOPPED,
  type CallInputs,
  type CallKey,
  type MessageResult,
  type ReportInput,
  callKeyOf,
  encodeEntry,
  goalForRequest,
  TOOL_INTENT_GUIDE,
  createToolIntent,
  createToolPolicy,
  offersToolIntent,
  type ConversationFacts,
  type RunEndFacts,
  type StartResult,
  type RetractResult,
  type Step,
  type TurnInput,
  type HostPorts,
  type JobKind,
  type JobSpec,
  type Key,
  type SubagentOrigin,
  FORK_PLACEHOLDER_RESULT,
  INTERRUPTED_CALL_RESULT
} from '@cherrystudio/agent-behavior/policy'
import { type JsonValue, type InputId, type ThreadId, type ItemId } from '@cherrystudio/agent-runtime'

import { conversationId, nativeSummaryUsage, pages, readFacts, threadId, type DurableFolds } from './history'

type Scope = {
  ended: boolean
  input?: { thread: ThreadId; id: InputId }
  task?: TaskId
  context: Context
  commit<T>(run: (tx: Tx) => Promise<T>): Promise<T>
  memo<T extends JsonValue>(name: string, produce: () => Promise<T>): Promise<T>
}

type NativeTool = ToolSpec & { run(scope: Scope, call: ToolCall): Promise<ToolOutcome> }
export interface BehaviorHooks {
  readonly tools: readonly NativeTool[]
  readonly hasJob: (kind: JobKind) => boolean
  runJob(scope: Scope, job: JobSpec): Promise<void>
  beforeTool?(
    call: GateCall & { readonly signal: AbortSignal },
    facts: GateFacts,
    memo: Scope['memo']
  ): Promise<GateVerdict>
  afterTool?(call: GateCall, result: ToolOutcome, memo: Scope['memo']): Promise<ToolOutcome | undefined>
  checkRequest?(thread: ThreadId, requests: number, lineage: 'child' | 'root'): RequestAllowance
  onOpen?(scope: Scope, thread: ThreadId, reopened: boolean): Promise<void>
  onCompacted?(scope: Scope, thread: ThreadId): Promise<void>
  onClose?(scope: Scope, thread: ThreadId): Promise<void>
}

interface BehaviorOptions {
  /** Shared with the runtime that owns the storage. */
  readonly folds: DurableFolds
  readonly onError?: (error: unknown) => void
  readonly owns?: (thread: ThreadId) => boolean
  readonly configureRoot?: (thread: ThreadId) => AgentChange | Promise<AgentChange>
  readonly configureChild: (
    child: ThreadId,
    parent: ThreadId,
    origin: SubagentOrigin
  ) => AgentChange | Promise<AgentChange>
}

export type PiDurableBehaviorOptions = BehaviorOptions &
  ({ readonly host: HostPorts } | { readonly hooks: BehaviorHooks })

/** Installs native behavior before opening the Harness and restores ownership before resume. */
export function createPiDurableBehavior(options: PiDurableBehaviorOptions) {
  const { folds } = options
  const host = 'host' in options ? options.host : undefined
  const hooks = 'hooks' in options ? options.hooks : undefined
  const policy = host && createToolPolicy(host)
  const abandoned = new Set<TaskId>()
  const admissions = new Map<ThreadId, Promise<unknown>>()
  const messages = new Map<TaskId, Set<Promise<unknown>>>()
  const stopWaiting = new AbortController()
  let unsubscribe: (() => void) | undefined
  let unsubscribeClose: (() => void) | undefined
  let harness: Harness
  let closed = false
  let recovering = true
  const nativeTools = [...goalToolSpecs, ...subagentToolSpecs, ...interactionToolSpecs, recallToolSpec]
  type ToolName = (typeof nativeTools)[number]['name']
  const tools = host
    ? nativeTools.map((spec) => ({
        ...spec,
        run: (scope: Scope, call: ToolCall) => runTool(scope, host, spec.name, call)
      }))
    : (hooks?.tools ?? [])
  const context = BACKGROUND_CONTEXT
  const meterDoc = defineDoc({
    kind: 'cherry.request-meter',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    checkpointWhen: () => false,
    initial: (): { run: number; count: number; counts?: Record<string, number> } => ({ run: 0, count: 0 })
  })
  const hostMemo = defineDoc({
    kind: 'cherry.host-memo',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    checkpointWhen: () => false,
    initial: (): { values: Record<string, NativeJson> } => ({ values: {} })
  })
  const providers = new Map<string, ThreadId>()
  async function consumeRequest(thread: ThreadId, ownerRun?: number) {
    return harness.commit(async (tx) => {
      const id = conversationId(thread)
      const record = await tx.conversation(id)
      const live = await tx.doc(LiveDoc, id)
      const count = await tx.doc(meterDoc, id)
      const run = ownerRun ?? live.run?.id ?? live.run?.taskId ?? 0
      count.counts ??= count.run ? { [String(count.run)]: count.count } : {}
      const counts = count.counts
      const requests = counts[String(run)] ?? 0
      const lineage = record?.owner ? 'child' : 'root'
      const allowance = host
        ? allowRequest(requests, lineage)
        : (hooks?.checkRequest?.(thread, requests, lineage) ?? { ok: true as const })
      if (!allowance.ok) return allowance
      if (run) counts[String(run)] = requests + 1
      count.run = run
      count.count = run ? requests + 1 : 0
      return allowance
    }, context)
  }
  async function providerThread(sessionId: string): Promise<ThreadId> {
    const known = providers.get(sessionId)
    if (known) return known
    await harness.commit(async (tx) => {
      for (const record of await pages((cursor) => tx.scanConversations({}, 256, cursor))) {
        const provider = await tx.doc(ProviderDoc, record.id)
        if (provider.sessionId) providers.set(provider.sessionId, threadId(record.id))
      }
    }, context)
    const found = providers.get(sessionId)
    if (!found) throw new Error('Unknown Durable provider session')
    return found
  }
  const remember =
    (api: HookApi, callContext: Context) =>
    async <T extends JsonValue>(name: string, produce: () => Promise<T>): Promise<T> =>
      ((await api.memo(name, callContext)) ?? (await api.memo(name, nativeValue(await produce()), callContext))) as T

  const native = async (thread: ThreadId) => {
    const conversation = await harness.conversation(conversationId(thread), context)
    if (!conversation) throw new Error(`Unknown Durable conversation ${thread}`)
    return conversation
  }
  const read = (thread: ThreadId) =>
    harness.commit((tx) => readFacts(tx, folds, conversationId(thread), abandoned), context)
  const submission = (thread: ThreadId, key: Key) =>
    harness.commit((tx) => tx.submissionByRequest(conversationId(thread), key), context)
  const latestRun = async (thread: ThreadId) => {
    const facts = await read(thread)
    return facts.history.findLast((item) => item.kind === 'user' || item.kind === 'marker')?.id
  }
  async function stop(thread: ThreadId): Promise<void> {
    const id = conversationId(thread)
    if (!recovering) {
      const tasks = await harness.commit(
        (tx) => pages((cursor) => tx.scanTasks({ conversationId: id }, 256, cursor)),
        context
      )
      await (await native(thread)).abort(context)
      await Promise.all(tasks.flatMap((task) => [...(messages.get(task.id) ?? [])]))
      return
    }
    const live = await harness.snapshot(LiveDoc, id, context)
    const inbox = await harness.snapshot(InboxDoc, id, context)
    if (live?.run) await harness.abortTask(live.run.taskId, context)
    for (const item of inbox?.items ?? [])
      if (item.mode !== 'write') await harness.abortSubmission(item.id, context, id)
  }
  function admit<T>(thread: ThreadId, operation: () => Promise<T>): Promise<T> {
    const work = (admissions.get(thread) ?? Promise.resolve()).then(operation)
    admissions.set(
      thread,
      work.catch(() => {})
    )
    return work
  }
  function trackMessage<T>(task: TaskId | undefined, work: Promise<T>): Promise<T> {
    if (task === undefined) return work
    const pending = messages.get(task) ?? new Set<Promise<unknown>>()
    messages.set(task, pending)
    pending.add(work)
    void work
      .finally(() => {
        pending.delete(work)
        if (!pending.size) messages.delete(task)
      })
      .catch(() => {})
    return work
  }

  async function waitFor<T>(read: () => Promise<T | undefined>, callContext: Context): Promise<T> {
    const waiting = withAbortSignal(stopWaiting.signal, callContext)
    for (;;) {
      let changed!: () => void
      const update = new Promise<void>((resolve) => {
        changed = resolve
      })
      const off = harness.observeCommits({ advance: changed, end: changed }).detach
      try {
        waiting.abortSignal?.throwIfAborted()
        const value = await read()
        if (value !== undefined) return value
        await awaitWithContext(update, waiting)
      } finally {
        off()
      }
    }
  }

  async function invoke<T>(scope: Scope, run: (scope: Scope) => Promise<T>): Promise<T> {
    try {
      return await run(scope)
    } finally {
      scope.ended = true
    }
  }
  const enter = <T>(scope: Scope, run: () => Promise<T>): Promise<T> => {
    if (closed || scope.ended) return Promise.reject(new Error('Durable behavior call is closed'))
    return run()
  }
  async function withHostScope<T>(
    thread: ThreadId,
    run: (scope: Scope) => Promise<T>,
    call?: { inputId?: InputId; signal?: AbortSignal }
  ): Promise<T> {
    await native(thread)
    const context = call?.signal ? withAbortSignal(call.signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT
    return invoke(
      {
        ended: false,
        ...(call?.inputId && { input: { thread, id: call.inputId } }),
        context,
        commit: (call) => harness.commit(call, context),
        async memo(name, produce) {
          const id = conversationId(thread)
          const known = await harness.commit(async (tx) => (await tx.doc(hostMemo, id)).values[name], context)
          if (known !== undefined) return known as Awaited<ReturnType<typeof produce>>
          const value = await produce()
          return harness.commit(async (tx) => {
            const doc = await tx.doc(hostMemo, id)
            doc.values[name] ??= nativeValue(value)
            return doc.values[name] as Awaited<ReturnType<typeof produce>>
          }, context)
        }
      },
      run
    )
  }
  const jobTask = defineTask<
    { key: string; job: JobSpec; input?: { thread: ThreadId; id: InputId } },
    { phase: 'run' },
    null
  >({
    name: 'cherry.behavior-job',
    version: 1,
    initial: () => ({ phase: 'run' }),
    phases: {
      async run(task, runtime, callContext) {
        await invoke(
          {
            ended: false,
            input: task.input.input,
            task: runtime.taskId,
            context: callContext,
            async commit(change) {
              let result!: Awaited<ReturnType<typeof change>>
              await runtime.commit(async (tx) => {
                result = await change(tx)
                return undefined
              }, callContext)
              return result
            },
            async memo(name, produce) {
              const value = await runtime.memo(name, callContext)
              return (value ?? (await runtime.memo(name, nativeValue(await produce()), callContext))) as Awaited<
                ReturnType<typeof produce>
              >
            }
          },
          (scope) => {
            if (host) return awaitWithContext(runJob(scope, host, task.input.job), callContext)
            if (!hooks) throw new Error('Missing behavior task handlers')
            return awaitWithContext(hooks.runJob(scope, task.input.job), callContext)
          }
        )
        await runtime.commit(
          async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
          callContext
        )
      }
    },
    async abort(_task, runtime, callContext) {
      await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), callContext)
    }
  })
  const backgroundOwner = defineTask<null, { phase: 'run' }, null>({
    name: 'cherry.child-owner',
    version: 1,
    initial: () => ({ phase: 'run' }),
    phases: {
      async run(_task, runtime, callContext) {
        await runtime.commit(
          async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
          callContext
        )
      }
    },
    async abort(_task, runtime, callContext) {
      await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), callContext)
    }
  })

  function transact<R extends JsonValue>(
    scope: Scope,
    thread: ThreadId,
    decide: (facts: ConversationFacts) => Step<R>
  ) {
    return enter(scope, () =>
      scope.commit(async (tx) => {
        const id = conversationId(thread)
        const facts = await readFacts(tx, folds, id, abandoned)
        const step = decide(facts)
        const seen = new Set<Key>()
        const ops = step.ops.filter(({ key }) => {
          if (facts.keysSeen.has(key) || seen.has(key)) return false
          seen.add(key)
          return true
        })
        for (const op of ops) {
          if (op.type === 'append-record' || op.type === 'append-quiet') {
            const target = conversationId(op.thread)
            if (
              op.type === 'append-quiet' &&
              ((await tx.doc(LiveDoc, target)).run || (await tx.doc(InboxDoc, target)).items.length)
            )
              throw new Error('Cannot append a quiet input while busy')
            if (op.type === 'append-record' && op.record.type === 'subagent-run' && op.record.value.run > 1) {
              const child = await tx.conversation(conversationId(op.record.value.sessionId))
              const owner = child?.owner && (await tx.task(child.owner.taskId))
              if (owner && !owner.background) throw new Error('Durable cannot detach a foreground child continuation')
            }
          }
          if (op.type === 'spawn-child' && op.spec.boundary === 'foreground' && !scope.task)
            throw new Error('Foreground children require a native tool task')
          if (op.type === 'ensure-job' && hooks && !hooks.hasJob(op.job.kind)) throw new Error('Unknown behavior job')
        }
        const forkPoints = new Map<string, EntryRecord | undefined>()
        for (const op of ops)
          if (op.type === 'spawn-child' && op.spec.fork)
            forkPoints.set(op.key, await tx.entry(Number(op.spec.fork.at) as never))
        const spawned: { key: Key; child: ThreadId }[] = []
        for (const op of ops) {
          if (op.type === 'append-record')
            await tx.appendEntry(conversationId(op.thread), nativeValue(encodeEntry(op.record, op.key)))
          if (op.type === 'append-quiet')
            await tx.appendEntry(conversationId(op.thread), {
              kind: op.input.kind,
              data: { ...(op.input.data as Record<string, JsonValue>), key: op.key },
              model: [{ role: 'user', content: op.input.text, timestamp: Date.now() }]
            })
          if (op.type === 'ensure-job')
            await tx.createTask(
              jobTask,
              { key: op.key, job: op.job, ...(scope.input && { input: scope.input }) },
              {
                conversationId: id,
                ownership: { kind: 'conversation' },
                background: true,
                abandonOnRestart: op.job.onRestart === 'abandon'
              }
            )
          if (op.type === 'spawn-child') {
            const owner =
              op.spec.boundary === 'foreground'
                ? scope.task!
                : await tx.createTask(backgroundOwner, null, {
                    conversationId: id,
                    ownership: { kind: 'conversation' },
                    background: true
                  })
            const ownership = { kind: 'task' as const, taskId: owner }
            const child = op.spec.fork
              ? await tx.forkConversation(conversationId(op.spec.fork.from), Number(op.spec.fork.at) as never, {
                  ownership
                })
              : await tx.createConversation({ ownership })
            const point = forkPoints.get(op.key)
            for (const message of point?.model ?? [])
              if (message.role === 'assistant')
                for (const part of message.content)
                  if (part.type === 'toolCall')
                    await tx.appendEntry(ToolResultEntry, child.id, {
                      data: { diagnostics: [] },
                      model: [
                        {
                          role: 'toolResult',
                          toolCallId: part.id,
                          toolName: part.name,
                          content: [
                            {
                              type: 'text',
                              text: op.spec.fork?.from === thread ? FORK_PLACEHOLDER_RESULT : INTERRUPTED_CALL_RESULT
                            }
                          ],
                          isError: op.spec.fork?.from !== thread,
                          timestamp: Date.now()
                        }
                      ]
                    })
            await configure(tx, child.id, await options.configureChild(threadId(child.id), thread, op.spec.origin))
            await configure(tx, child.id, {
              tools: {
                remove: extension.tools!.filter((_, index) => tools[index].availability === 'parent-only')
              }
            })
            await tx.appendEntry(
              child.id,
              nativeValue(encodeEntry({ type: 'subagent-origin', value: op.spec.origin }, op.key))
            )
            await tx.appendEntry(
              id,
              nativeValue(
                encodeEntry(
                  { type: 'subagent-run', value: { ...op.spec.record, sessionId: threadId(child.id) } },
                  op.key
                )
              )
            )
            spawned.push({ key: op.key, child: threadId(child.id) })
          }
        }
        return {
          result: step.result,
          effects: step.effects,
          spawned,
          changedChildren: ops.some(
            (op) => op.type === 'spawn-child' || (op.type === 'append-record' && op.record.type === 'subagent-run')
          )
        }
      })
    )
  }

  function modelContext(scope: Scope, thread: ThreadId) {
    return enter(scope, async () =>
      JSON.parse(JSON.stringify((await (await native(thread)).context(scope.context)).messages))
    )
  }

  function startTurn(scope: Scope, thread: ThreadId, input: TurnInput, key: Key): Promise<StartResult> {
    return enter(scope, async () => {
      try {
        const receipt = await (
          await native(thread)
        ).submit(
          {
            type: 'input',
            content: input.text,
            requestId: key,
            whenBusy: 'reject',
            entry: { kind: input.kind, data: { ...(input.data as Record<string, JsonValue>), key } }
          },
          scope.context
        )
        const record = await receipt.status(scope.context)
        return record.status === 'queued' || (record.status === 'unanswered' && record.entry === undefined)
          ? 'queued'
          : 'started'
      } catch (error) {
        if (error instanceof ConversationBusy) return 'busy'
        throw error
      }
    })
  }

  function retractTurn(scope: Scope, thread: ThreadId, key: Key): Promise<RetractResult> {
    return enter(scope, async () => {
      const record = await submission(thread, key)
      if (!record) return 'not-found'
      const result = await harness.abortSubmission(record.id, scope.context, conversationId(thread))
      return result === 'aborted' ? 'withdrawn' : result === 'already_placed' ? 'already-started' : 'settled'
    })
  }

  function stopTurn(scope: Scope, thread: ThreadId, turn?: ItemId) {
    return enter(scope, async () => {
      if (turn === undefined || (await latestRun(thread)) === turn) await stop(thread)
    })
  }

  function messageChild(scope: Scope, child: ThreadId, input: TurnInput, key: Key, reservedRun?: number) {
    return enter(scope, () =>
      trackMessage(
        scope.task,
        (async () => {
          if (scope.context.abortSignal?.aborted) return { status: 'withdrawn' as const, run: 0 }
          const id = conversationId(child)
          const receipt = await admit(child, async () => {
            scope.context.abortSignal?.throwIfAborted()
            const record = await scope.commit(async (tx) => {
              const child = await tx.conversation(id)
              const live = await tx.doc(LiveDoc, id)
              const owner = child?.owner && (await tx.task(child.owner.taskId))
              if (owner && !owner.background && !live.run && (await folds.advance(tx, id)).runIds().length)
                throw new Error('Durable cannot detach a foreground child continuation')
              return tx.submissionByRequest(id, key)
            })
            if (!record)
              await scope.commit(async (tx) => {
                if ((await tx.doc(LiveDoc, id)).run) return
                const fold = await folds.advance(tx, id)
                const open = fold.latestCalls.filter((call) => !fold.answered.has(call.id))
                for (const call of open)
                  await tx.appendEntry(ToolResultEntry, id, {
                    data: { diagnostics: [] },
                    model: [
                      {
                        role: 'toolResult',
                        toolCallId: call.id,
                        toolName: call.name,
                        content: [{ type: 'text', text: INTERRUPTED_CALL_RESULT }],
                        isError: true,
                        timestamp: Date.now()
                      }
                    ]
                  })
              })
            const submitted = record
              ? (await harness.submission(record.id, scope.context))!
              : await (
                  await native(child)
                ).submit(
                  {
                    type: 'input',
                    content: input.text,
                    requestId: key,
                    whenBusy: 'steer',
                    entry: {
                      kind: input.kind,
                      data: {
                        ...(input.data as Record<string, JsonValue>),
                        key,
                        ...(reservedRun !== undefined && { cherryRun: reservedRun }),
                        ...(scope.input?.thread === child && { cherryInputId: scope.input.id })
                      }
                    }
                  },
                  scope.context
                )
            return submitted
          })
          let consumed
          try {
            consumed = await waitFor(async () => {
              const value = await receipt.status(scope.context)
              return value.status !== 'queued' ? value : undefined
            }, scope.context)
          } catch (error) {
            if (!scope.context.abortSignal?.aborted) throw error
            const withdrawn = await harness.abortSubmission(receipt.id, context, id)
            if (withdrawn === 'aborted') {
              const count = await harness.commit(async (tx) => (await folds.advance(tx, id)).runIds().length, context)
              return { run: count, status: 'withdrawn' as const }
            }
            consumed = await receipt.status(context)
          }
          if (consumed.type !== 'input' || consumed.runId === undefined) {
            const count = await harness.commit(async (tx) => (await folds.advance(tx, id)).runIds().length, context)
            return { status: 'withdrawn' as const, run: count }
          }
          const ids = await harness.commit(async (tx) => (await folds.advance(tx, id)).runIds(), context)
          return {
            run: ids.indexOf(consumed.runId) + 1,
            status: consumed.runId > consumed.id ? ('started' as const) : ('queued' as const)
          }
        })().catch(async (error) => {
          if (!scope.context.abortSignal?.aborted) throw error
          const count = await harness.commit(
            async (tx) => (await folds.advance(tx, conversationId(child))).runIds().length,
            context
          )
          return { run: count, status: 'withdrawn' as const }
        })
      )
    )
  }

  function awaitChild(scope: Scope, child: ThreadId, run: number): Promise<RunEndFacts> {
    return enter(scope, () =>
      waitFor(
        async () =>
          scope.commit(async (tx) => {
            const id = conversationId(child)
            const fold = await folds.advance(tx, id)
            const runId = fold.runIds()[run - 1]
            if (runId === undefined) throw new Error(`Unknown child run ${run}`)
            const live = await tx.doc(LiveDoc, id)
            if ((live.run?.id ?? live.run?.taskId) === runId) return undefined
            const last = fold.replies.get(runId)
            const task = fold.runTasks.get(runId)
            const outcome = task === undefined ? undefined : (await tx.task(task))?.state.outcome
            const text = last?.text ?? ''
            const error = last?.error ?? (outcome && 'error' in outcome ? outcome.error?.message : undefined)
            return {
              text,
              ...(error && { error }),
              outcome: error?.includes('quota exceeded')
                ? 'limit_reached'
                : outcome?.status === 'aborted' || last?.stop === 'aborted'
                  ? 'aborted'
                  : last?.stop === 'length'
                    ? 'truncated'
                    : outcome?.status !== 'completed' || last?.stop !== 'stop'
                      ? 'failed'
                      : 'completed'
            }
          }),
        scope.context
      )
    )
  }

  function stopChild(scope: Scope, child: ThreadId, run: number) {
    return enter(scope, () =>
      admit(child, async () => {
        const id = conversationId(child)
        for (;;) {
          const task = await scope.commit(async (tx) => {
            const ids = (await folds.advance(tx, id)).runIds()
            const live = await tx.doc(LiveDoc, id)
            const inbox = await tx.doc(InboxDoc, id)
            return live.run && (live.run.id ?? live.run.taskId) === ids[run - 1]
              ? {
                  id: live.run.taskId,
                  queued: inbox.items.filter((item) => item.mode !== 'write').map((item) => item.id)
                }
              : undefined
          })
          if (task === undefined) return
          for (const input of task.queued) await harness.abortSubmission(input, context, id)
          await harness.abortTask(task.id, context)
          if (recovering) return
          await harness.waitForTask(task.id, context)
        }
      })
    )
  }

  function waitForIdle(scope: Scope, thread: ThreadId) {
    return enter(scope, async () => {
      while (true) {
        const live = await harness.snapshot(LiveDoc, conversationId(thread), scope.context)
        if (!live?.run) return
        await harness.waitForTask(live.run.taskId, scope.context)
      }
    })
  }

  function waitForSubmission(scope: Scope, thread: ThreadId, key: Key) {
    return enter(scope, async () => {
      const record = await submission(thread, key)
      if (!record) return
      await (await harness.submission(record.id, scope.context))!.wait(scope.context)
    })
  }

  function scopedFacts(scope: Scope, thread: ThreadId) {
    return enter(scope, () => scope.commit((tx) => readFacts(tx, folds, conversationId(thread), abandoned)))
  }

  function callInputs(
    host: HostPorts,
    thread: ThreadId,
    extra: Pick<CallInputs, 'models' | 'verdict' | 'args'> = {}
  ): CallInputs {
    return { now: Date.now(), settings: settingsSnapshot(host.settings, thread), ...extra }
  }

  async function emitChildViews(scope: Scope, host: HostPorts, thread: ThreadId) {
    const facts = await scopedFacts(scope, thread)
    host.observation.emit({ type: 'subagents', thread, views: subagentViews(facts) })
  }

  async function runStep<R extends JsonValue>(
    scope: Scope,
    host: HostPorts,
    thread: ThreadId,
    decide: (facts: ConversationFacts) => Step<R>
  ) {
    const committed = await transact(scope, thread, decide)
    let started: StartResult | undefined
    let retracted: RetractResult | undefined
    let messaged: MessageResult | undefined
    let changedChildren = committed.changedChildren
    for (const effect of committed.effects) {
      switch (effect.type) {
        case 'start-turn':
          started = await startTurn(scope, effect.thread, effect.input, effect.key)
          break
        case 'retract-turn':
          retracted = await retractTurn(scope, effect.thread, effect.key)
          break
        case 'message-child':
          messaged = await messageChild(scope, effect.child, effect.input, effect.key)
          changedChildren = true
          break
        case 'stop-turn':
          await stopTurn(scope, effect.thread, effect.turn)
          break
        case 'stop-child':
          await stopChild(scope, effect.child, effect.run)
          changedChildren = true
          break
        case 'emit':
          host.observation.emit(effect.event)
      }
    }
    if (changedChildren) await emitChildViews(scope, host, thread)
    return { ...committed, started, retracted, messaged }
  }

  async function continueChild(scope: Scope, host: HostPorts, call: ToolCall): Promise<SubagentMessageReceipt> {
    for (;;) {
      const inputs = callInputs(host, call.thread, { args: call.args })
      const { result, messaged } = await runStep(scope, host, call.thread, (facts) =>
        decideMessage(facts, inputs, call.key, call.signal.aborted)
      )
      switch (result.kind) {
        case 'refused':
          return { status: 'refused', reason: result.text }
        case 'queued':
          if (messaged?.status === 'withdrawn') {
            await runStep(scope, host, call.thread, (facts) => decideSteerWithdrawn(facts, call.key))
            return { status: 'refused', reason: notDeliveredText(result.child) }
          }
          if (messaged?.status === 'started') {
            const text = stringField(fieldsOf(call.args), 'message')!.trim()
            await runStep(scope, host, call.thread, (facts) =>
              decideMessageStarted(facts, call.key, messaged.run, text)
            )
            return { status: 'continued', child: result.child }
          }
          return { status: 'queued', child: result.child }
        case 'continued':
          return { status: 'continued', child: result.child }
        case 'stopping':
          await awaitChild(scope, result.child, result.run)
      }
    }
  }

  async function runTool(scope: Scope, host: HostPorts, name: ToolName, call: ToolCall): Promise<ToolOutcome> {
    const { thread, key, args, signal } = call
    switch (name) {
      case 'get_goal':
        return (await runStep(scope, host, thread, decideGetGoal)).result
      case 'create_goal': {
        const inputs = callInputs(host, thread, { args })
        return (await runStep(scope, host, thread, (facts) => decideCreateGoal(facts, inputs, key))).result
      }
      case 'update_goal': {
        const inputs = callInputs(host, thread, { args })
        const { result } = await runStep(scope, host, thread, (facts) => decideUpdateGoal(facts, inputs, key))
        if (!('verify' in result)) return result
        const { objective, claim } = result.verify
        const verdict = await enter(scope, () =>
          scope.memo(keys.verdictMemo(key), async () =>
            host.verifier.verify({ thread, objective, claim, context: await modelContext(scope, thread) }, signal)
          )
        ).catch((error: unknown) => reasonOf(error))
        if (typeof verdict === 'string') return { text: unverifiedText(verdict), isError: true }
        const after = callInputs(host, thread, { args, verdict })
        const decided = await runStep(scope, host, thread, (facts) => decideUpdateGoal(facts, after, key))
        if ('verify' in decided.result) throw new Error('update_goal asked again for the verdict it was given')
        return decided.result
      }
      case 'subagent': {
        const models = await modelFacts(host, thread, stringField(fieldsOf(args), 'model')?.trim() || undefined)
        const inputs = callInputs(host, thread, { args, models })
        if (signal.aborted) return { text: TURN_STOPPED, isError: true }
        const { result, spawned } = await runStep(scope, host, thread, (facts) => decideSpawn(facts, inputs, key))
        if (result.kind === 'refused') return { text: result.text, isError: true }
        const child = result.child ?? spawned.find((entry) => entry.key === result.key)?.child
        if (!child) throw new Error(`The commit reported no child spawned under ${result.key}`)
        if (result.background)
          return {
            text: startedText(child),
            isError: false,
            details: { sessionId: child, fork: result.fork, background: true }
          }
        if (signal.aborted) return abandonSpawn(scope, host, thread, key)
        return runChild(scope, host, thread, child, 1, result.input, key)
      }
      case 'message_subagent':
        return messageToolResult(await continueChild(scope, host, call))
      case 'stop_subagent': {
        const inputs = callInputs(host, thread, { args })
        const { result } = await runStep(scope, host, thread, (facts) => decideStop(facts, inputs))
        if (result.kind === 'refused') return { text: result.text, isError: true }
        if (result.kind === 'not-running' || result.kind === 'ended') return result.result
        return stoppedResult(result.child, result.run, await awaitChild(scope, result.child, result.run))
      }
      case 'AskUserQuestion': {
        const decision = decideAskUser((await scopedFacts(scope, thread)).lineage, args)
        if (decision.kind === 'answered') return decision.result
        const { questions } = decision
        const answer = await enter(scope, () =>
          scope.memo(keys.askMemo(key), () => host.questions.ask({ call: { thread, key }, questions }, signal))
        ).catch((error: unknown) => {
          if (signal.aborted) return undefined
          throw error
        })
        return askUserResult(questions, answer)
      }
      case 'todo_write':
        return decideTodos(args)
      case 'vcc_recall':
        return { text: recallText((await scopedFacts(scope, thread)).history, args), isError: false }
    }
  }

  async function abandonSpawn(scope: Scope, host: HostPorts, parent: ThreadId, call: CallKey) {
    await runStep(scope, host, parent, (facts) => decideSpawnAbandoned(facts, keys.subagentSpawn(call)))
    return { text: TURN_STOPPED, isError: true }
  }

  async function runChild(
    scope: Scope,
    host: HostPorts,
    parent: ThreadId,
    child: ThreadId,
    run: number,
    input: TurnInput,
    call: CallKey,
    key = keys.subagentMessage(child, run)
  ) {
    const admitted = await messageChild(scope, child, input, key, run)
    if (admitted.status === 'withdrawn') return abandonSpawn(scope, host, parent, call)
    if (runStopping((await scopedFacts(scope, parent)).history, child, run)) await stopChild(scope, child, admitted.run)
    const answer = await awaitChild(scope, child, admitted.run)
    const report = await storeChildReport(host, call, runReport(answer))
    return (await runStep(scope, host, parent, (facts) => decideRunEnd(facts, child, run, answer, report))).result
  }

  async function runJob(scope: Scope, host: HostPorts, job: JobSpec) {
    const thread = job.scope
    switch (job.kind) {
      case 'subagent-report': {
        // V1 report payloads are written by ensureReport.
        const input = job.input as ReportInput
        const facts = await scopedFacts(scope, thread)
        const target = reportTarget(facts, input)
        const origin = target && readSubagents(facts.history).find(({ child }) => child === target.child)
        if (target && origin)
          await runChild(
            scope,
            host,
            thread,
            target.child,
            target.run,
            turnInput({ type: 'subagent-message' }, input.text),
            callKeyOf(origin.latest.parentToolCallId),
            input.messageKey
          )
        return
      }
      case 'idle-driver':
        for (;;) {
          await waitForIdle(scope, thread)
          const inputs = callInputs(host, thread)
          const { result, effects, started } = await runStep(scope, host, thread, (facts) =>
            decideAtIdle(facts, inputs)
          )
          if (result.kind === 'done') {
            if (
              result.reason === 'plan-mode' &&
              host.settings.permissionMode(thread) !== inputs.settings.permissionMode
            )
              await runStep(scope, host, thread, decidePermissionModeChanged)
            return
          }
          const start = effects.find((effect) => effect.type === 'start-turn')
          if (!start || started === 'busy') continue
          if (result.kind === 'start-round') {
            const admission = callInputs(host, thread)
            const admitted = await runStep(scope, host, thread, (facts) => admitRound(facts, admission, result))
            if (admitted.retracted === 'already-started')
              await runStep(scope, host, thread, (facts) => decideRoundWithdrawn(facts, admission, result))
          }
          await waitForSubmission(scope, thread, start.key)
        }
    }
    throw new Error(`Unknown behavior job ${job.kind}`)
  }

  async function openConversation(thread: ThreadId, reopened: boolean) {
    if (!host) return withHostScope(thread, async (scope) => hooks?.onOpen?.(scope, thread, reopened))
    await withHostScope(thread, async (scope) => {
      const inputs = callInputs(host, thread)
      const { supportsTools } = await host.models.current(thread)
      await runStep(scope, host, thread, (facts) => decideOnOpen(facts, inputs, { reopened, supportsTools }))
      if (reopened) await emitChildViews(scope, host, thread)
    })
  }

  async function compacted(thread: ThreadId) {
    if (!host) return withHostScope(thread, async (scope) => hooks?.onCompacted?.(scope, thread))
    await withHostScope(thread, (scope) =>
      runStep(scope, host, thread, (facts) => ({ ops: [ensureDriver(facts)], effects: [], result: null }))
    )
  }

  const intent = createToolIntent()
  const extension: Extension = defineExtension({
    name: 'cherry.behavior',
    tasks: [jobTask, backgroundOwner],
    // A DeepSeek agent's tools offer `intent`; every call drops it before the tool's own repair, validation, hooks and run.
    wrapTools: (tool, model) => intent(tool, offersToolIntent(model?.modelId)),
    sections: [
      {
        key: 'tool_intent',
        render: ({ agent }) => (offersToolIntent(agent.model?.modelId) ? TOOL_INTENT_GUIDE : undefined)
      }
    ],
    tools: tools.map((tool) =>
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.schema as object,
        replay: tool.replay,
        executionMode: tool.executionMode,
        callers: ['model'],
        async execute(args, api, callContext) {
          const result = await invoke(
            {
              ended: false,
              task: api.taskId,
              context: callContext,
              commit: (run) => api.commit(run, callContext),
              async memo(name, produce) {
                return ((await api.memo(name, callContext)) ??
                  (await api.memo(name, nativeValue(await produce()), callContext))) as Awaited<
                  ReturnType<typeof produce>
                >
              }
            },
            (scope) => {
              const call = {
                key: callKeyOf(String(api.taskId)),
                thread: threadId(api.conversationId),
                args: copyJson(args),
                signal: callContext.abortSignal ?? new AbortController().signal
              }
              return tool.run(scope, call)
            }
          )
          return {
            output: [{ type: 'text', text: result.text }],
            isError: result.isError,
            ...(result.details !== undefined && { details: nativeValue(result.details) })
          }
        }
      })
    ),
    hooks: [
      hook(ToolTask, {
        async beforeTool(call, api, callContext) {
          if (!policy && !hooks?.beforeTool) return
          const view = await harness.commit(async (tx) => {
            const fold = await folds.advance(tx, api.conversationId)
            const turn = fold.history[fold.turn]
            const goalRound = turn?.kind === 'marker' && turn.marker.type === 'goal-round'
            return {
              plan: fold.plan,
              goalRound,
              callWindow: goalRound
                ? fold.history.slice(fold.turn).flatMap((item) => (item.kind === 'assistant' ? item.toolCalls : []))
                : []
            }
          }, context)
          const gated = {
            key: callKeyOf(String(api.taskId)),
            thread: threadId(api.conversationId),
            tool: call.name,
            args: call.arguments,
            nested: !!call.parent,
            signal: callContext.abortSignal ?? new AbortController().signal
          }
          const result = policy
            ? await policy.approve(gated, view, remember(api, callContext))
            : await hooks?.beforeTool?.(gated, view, remember(api, callContext))
          if (!result) return
          return {
            block: result.block,
            arguments: result.args === undefined ? undefined : (nativeValue(result.args) as Record<string, NativeJson>)
          }
        },
        async afterTool(call, result, api, callContext) {
          if (!policy && !hooks?.afterTool) return
          const gated = {
            key: callKeyOf(String(api.taskId)),
            thread: threadId(api.conversationId),
            tool: call.name,
            args: call.arguments,
            nested: !!call.parent
          }
          const output: NonNullable<typeof result.output> = []
          let isError = result.isError
          let details = result.details
          const blocks = result.output ?? []
          for (let index = 0; index < blocks.length;) {
            const block = blocks[index]
            if (block.type !== 'text') {
              output.push(block)
              index += 1
              continue
            }
            const start = index
            let text = ''
            while (index < blocks.length) {
              const next = blocks[index]
              if (next.type !== 'text') break
              text += next.text
              index += 1
            }
            const span = { text, isError: isError ?? false, details }
            const replaced = policy
              ? await policy.offload(gated, span)
              : await hooks?.afterTool?.(gated, span, remember(api, callContext))
            output.push(...(replaced ? [{ type: 'text' as const, text: replaced.text }] : blocks.slice(start, index)))
            if (replaced) {
              isError = replaced.isError
              if (replaced.details !== undefined) details = nativeValue(replaced.details)
            }
          }
          return { ...result, output, isError, details }
        }
      }),
      hook(CompactionTask, {
        async beforeCompact(request, api, callContext) {
          if (request.ownerAt === undefined) return { decline: true }
          const facts = await harness.commit(
            (tx) => readFacts(tx, folds, api.conversationId, abandoned, request.ownerAt),
            callContext
          )
          await api.memo('cherry.native-summary-owner', nativeValue(goalForRequest(facts.history)), callContext)
        },
        async beforeSummary(request, api) {
          const allowance = await consumeRequest(threadId(api.conversationId), request.runId ?? 0)
          if (!allowance.ok) return { block: allowance.text }
        },
        async afterSummary(response, tx) {
          const owner = response.memos['cherry.native-summary-owner']
          if (!owner || typeof owner !== 'object' || Array.isArray(owner))
            throw new Error('Native compaction has no captured goal owner')
          const goalId = owner.goalId
          const goalRoundId = owner.goalRoundId
          if (
            (goalId !== null && typeof goalId !== 'string') ||
            (goalRoundId !== undefined && typeof goalRoundId !== 'string')
          )
            throw new Error('Native compaction has an invalid goal owner')
          const value = response.message.usage
          const task = await tx.task(response.taskId)
          if (!task) throw new Error('Native compaction task is missing')
          const doc = await tx.doc(nativeSummaryUsage, task.conversationId)
          doc.records[`${response.taskId}:${response.attempt}`] ??= {
            owner: { goalId, ...(goalRoundId === undefined ? {} : { goalRoundId }) },
            usage: {
              input: value.input,
              output: value.output,
              cacheRead: value.cacheRead,
              cacheWrite: value.cacheWrite,
              totalTokens: value.totalTokens,
              costUsd: value.cost.total
            },
            ...(response.runId === undefined ? {} : { runId: response.runId })
          }
        }
      })
    ]
  })
  const commands = host && {
    permissionModeChanged: (thread: ThreadId) =>
      withHostScope(thread, (scope) => runStep(scope, host, thread, decidePermissionModeChanged)),
    goal: (thread: ThreadId, text: string, inputId: InputId) =>
      withHostScope(thread, async (scope) => {
        const current = await host.models.current(thread)
        const inputs = callInputs(host, thread, { models: { candidates: [], ...current } })
        return (await runStep(scope, host, thread, (facts) => decideGoalCommand(facts, inputs, text, inputId))).result
      }),
    messageChild: (parent: ThreadId, child: ThreadId, text: string, inputId: InputId) =>
      withHostScope(
        child,
        (scope) =>
          continueChild(scope, host, {
            key: callKeyOf(`host-message:${JSON.stringify([parent, inputId])}`),
            thread: parent,
            args: { id: child, message: text },
            signal: context.abortSignal ?? new AbortController().signal
          }),
        { inputId }
      ),
    stop: (thread: ThreadId, requestKey: string, parent?: ThreadId) =>
      withHostScope(thread, async (scope) => {
        const owner = parent ?? thread
        const inputs = callInputs(host, owner)
        if (parent) await runStep(scope, host, parent, (facts) => decideStopSubagent(facts, inputs, thread, requestKey))
        else await runStep(scope, host, thread, (facts) => decideUserStop(facts, inputs, requestKey))
      })
  }

  return {
    extension,
    commands,
    operations: hooks
      ? {
          withHostScope,
          scopedFacts,
          transact,
          modelContext,
          startTurn,
          retractTurn,
          stopTurn,
          messageChild,
          awaitChild,
          stopChild,
          waitForIdle,
          waitForSubmission,
          remember: <T extends JsonValue>(scope: Scope, name: string, produce: () => Promise<T>) =>
            enter(scope, () => scope.memo(name, produce))
        }
      : undefined,
    consumeRequest,
    providerThread,
    async bind(value: Harness) {
      harness = value
      unsubscribeClose = harness.subscribeClose(() => {
        closed = true
        stopWaiting.abort()
      })
      recovering = true
      const tasks = await harness.commit((tx) => pages((cursor) => tx.scanTasks({}, 256, cursor)), context)
      for (const task of tasks) if (task.abandonOnRestart && task.state.status !== 'terminal') abandoned.add(task.id)
      const conversations = await harness.commit(
        (tx) => pages((cursor) => tx.scanConversations({}, 256, cursor)),
        context
      )
      for (const conversation of conversations) {
        const thread = threadId(conversation.id)
        if (options.owns && !options.owns(thread)) continue
        const facts = await read(thread)
        if (facts.lineage.kind === 'subagent') {
          const change = await options.configureChild(thread, facts.lineage.parent, facts.lineage.origin)
          await harness.commit((tx) => configure(tx, conversation.id, change), context)
        } else if (options.configureRoot) {
          const change = await options.configureRoot(thread)
          await harness.commit((tx) => configure(tx, conversation.id, change), context)
        }
        await openConversation(thread, true)
      }
      recovering = false
      unsubscribe = harness.observeCommits({
        advance(publication) {
          for (const change of publication.changes) {
            if (change.type !== 'entry' || !CompactionEntry.is(change.value)) continue
            const thread = threadId(change.value.conversationId)
            void compacted(thread).catch(options.onError ?? (() => {}))
          }
        },
        end() {}
      }).detach
    },
    async open(thread: ThreadId) {
      await openConversation(thread, false)
    },
    async close() {
      unsubscribe?.()
      const onClose = hooks?.onClose
      if (onClose) {
        const conversations = await harness.commit(
          (tx) => pages((cursor) => tx.scanConversations({}, 256, cursor)),
          context
        )
        for (const conversation of conversations) {
          const thread = threadId(conversation.id)
          if (options.owns && !options.owns(thread)) continue
          await withHostScope(thread, (scope) => onClose(scope, thread))
        }
      }
      closed = true
      await Promise.all([...admissions.values()])
      stopWaiting.abort()
      unsubscribeClose?.()
    }
  }
}

export type PiDurableBehavior = ReturnType<typeof createPiDurableBehavior>

function nativeValue<T>(value: T): JsonRepresentation<T> {
  return copyJson(value, { omitUndefinedProperties: true }) as JsonRepresentation<T>
}
