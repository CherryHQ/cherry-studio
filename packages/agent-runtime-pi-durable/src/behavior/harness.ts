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
  callKeyOf,
  encodeEntry,
  goalForRequest,
  TOOL_INTENT_GUIDE,
  createToolIntent,
  createToolPolicy,
  install,
  offersToolIntent,
  type BoundPorts,
  type GateHandlers,
  type HostPorts,
  type HarnessPorts,
  type JobHandler,
  type JobKind,
  type JobSpec,
  type Key,
  type LifecycleHandlers,
  type SubagentOrigin,
  type ToolDefinition,
  FORK_PLACEHOLDER_RESULT,
  INTERRUPTED_CALL_RESULT
} from '@cherrystudio/agent-behavior'
import { type JsonValue, type InputId, type ThreadId } from '@cherrystudio/agent-runtime'

import { conversationId, nativeSummaryUsage, pages, readFacts, threadId, type DurableFolds } from './history'

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
  ({ readonly host: HostPorts } | { readonly install: (ports: HarnessPorts) => void })

/** Native ports are installed before opening the Harness; recovery runs before enabling its scheduler. */
export function createPiDurableBehavior(options: PiDurableBehaviorOptions) {
  const { folds } = options
  const abandoned = new Set<TaskId>()
  const admissions = new Map<ThreadId, Promise<unknown>>()
  const messages = new Map<TaskId, Set<Promise<unknown>>>()
  const stopWaiting = new AbortController()
  let unsubscribe: (() => void) | undefined
  let unsubscribeClose: (() => void) | undefined
  let harness: Harness
  let closed = false
  let recovering = true
  let lifecycle: LifecycleHandlers | undefined
  let meter: Parameters<HarnessPorts['requestMeter']['register']>[0] | undefined
  let customGate: GateHandlers | undefined
  const tools: ToolDefinition[] = []
  const jobs = new Map<JobKind, JobHandler>()
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
      const allowance = meter?.allow(thread, requests, record?.owner ? 'child' : 'root') ?? { ok: true as const }
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

  const gatePorts = (api: HookApi, callContext: Context) => ({
    clock: { now: () => Date.now() },
    memory: { remember: remember(api, callContext) }
  })
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

  type Scope = {
    ended: boolean
    input?: { thread: ThreadId; id: InputId }
    task?: TaskId
    context: Context
    commit<T>(run: (tx: Tx) => Promise<T>): Promise<T>
    memo<T extends JsonValue>(name: string, produce: () => Promise<T>): Promise<T>
  }
  async function invoke<T>(scope: Scope, run: (ports: BoundPorts) => Promise<T>): Promise<T> {
    try {
      return await run(bound(scope))
    } finally {
      scope.ended = true
    }
  }
  const enter = <T>(scope: Scope, run: () => Promise<T>): Promise<T> => {
    if (closed || scope.ended) return Promise.reject(new Error('Durable behavior call is closed'))
    return run()
  }
  async function withCall<T>(
    thread: ThreadId,
    run: (ports: BoundPorts) => Promise<T>,
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
        const handler = jobs.get(task.input.job.kind)
        if (!handler) throw new Error(`Missing behavior job ${task.input.job.kind}`)
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
          (ports) => awaitWithContext(handler(ports, task.input.job), callContext)
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

  function bound(scope: Scope): BoundPorts {
    return {
      ledger: {
        read: (thread) =>
          enter(scope, () => scope.commit((tx) => readFacts(tx, folds, conversationId(thread), abandoned))),
        transact: (thread, decide) =>
          enter(scope, () =>
            scope.commit(async (tx) => {
              const id = conversationId(thread)
              const facts = await readFacts(tx, folds, id, abandoned)
              const step = decide(facts)
              for (const op of step.ops) {
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
                    if (owner && !owner.background)
                      throw new Error('Durable cannot detach a foreground child continuation')
                  }
                }
                if (op.type === 'spawn-child' && op.spec.boundary === 'foreground' && !scope.task)
                  throw new Error('Foreground children require a native tool task')
                if (op.type === 'ensure-job' && !jobs.has(op.job.kind)) throw new Error('Unknown behavior job')
              }
              const forkPoints = new Map<string, EntryRecord | undefined>()
              for (const op of step.ops)
                if (op.type === 'spawn-child' && op.spec.fork)
                  forkPoints.set(op.key, await tx.entry(Number(op.spec.fork.at) as never))
              const spawned: { key: Key; child: ThreadId }[] = []
              const seen = new Set(facts.keysSeen)
              for (const op of step.ops) {
                if (seen.has(op.key)) continue
                seen.add(op.key)
                if (op.type === 'append-record')
                  await tx.appendEntry(conversationId(op.thread), nativeValue(encodeEntry(op.record, op.key)))
                if (op.type === 'append-quiet')
                  await tx.appendEntry(conversationId(op.thread), {
                    kind: op.input.kind,
                    data: { ...(op.input.data as Record<string, JsonValue>), key: op.key },
                    model: [{ role: 'user', content: op.input.text, timestamp: Date.now() }]
                  })
                if (op.type === 'ensure-job' && !facts.keysSeen.has(op.key))
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
                                    text:
                                      op.spec.fork?.from === thread ? FORK_PLACEHOLDER_RESULT : INTERRUPTED_CALL_RESULT
                                  }
                                ],
                                isError: op.spec.fork?.from !== thread,
                                timestamp: Date.now()
                              }
                            ]
                          })
                  await configure(
                    tx,
                    child.id,
                    await options.configureChild(threadId(child.id), thread, op.spec.origin)
                  )
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
              return { result: step.result, effects: step.effects, spawned }
            })
          ),
        modelContext: (thread) =>
          enter(scope, async () =>
            JSON.parse(JSON.stringify((await (await native(thread)).context(scope.context)).messages))
          )
      },
      turns: {
        start: (thread, input, key) =>
          enter(scope, async () => {
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
          }),
        retract: (thread, key) =>
          enter(scope, async () => {
            const record = await submission(thread, key)
            if (!record) return 'not-found'
            const result = await harness.abortSubmission(record.id, scope.context, conversationId(thread))
            return result === 'aborted' ? 'withdrawn' : result === 'already_placed' ? 'already-started' : 'settled'
          }),
        stop: (thread, _cause, turn) =>
          enter(scope, async () => {
            if (turn === undefined || (await latestRun(thread)) === turn) await stop(thread)
          })
      },
      helpers: {
        message: (child, input, key, reservedRun) =>
          enter(scope, () =>
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
                    const count = await harness.commit(
                      async (tx) => (await folds.advance(tx, id)).runIds().length,
                      context
                    )
                    return { run: count, status: 'withdrawn' as const }
                  }
                  consumed = await receipt.status(context)
                }
                if (consumed.type !== 'input' || consumed.runId === undefined) {
                  const count = await harness.commit(
                    async (tx) => (await folds.advance(tx, id)).runIds().length,
                    context
                  )
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
          ),
        awaitAnswer: (child, run) =>
          enter(scope, () =>
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
          ),
        stop: (child, run) =>
          enter(scope, () =>
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
      },
      waits: {
        untilIdle: (thread) =>
          enter(scope, async () => {
            while (true) {
              const live = await harness.snapshot(LiveDoc, conversationId(thread), scope.context)
              if (!live?.run) return
              await harness.waitForTask(live.run.taskId, scope.context)
            }
          }),
        untilDone: (thread, key) =>
          enter(scope, async () => {
            const record = await submission(thread, key)
            if (!record) return
            await (await harness.submission(record.id, scope.context))!.wait(scope.context)
          })
      },
      memory: { remember: (key, produce) => enter(scope, () => scope.memo(key, produce)) },
      clock: { now: () => Date.now() }
    }
  }
  const registrations = {
    tools: { register: (tool) => tools.push(tool) },
    jobs: {
      register: (kind, handler) => {
        jobs.set(kind, handler)
      }
    },
    lifecycle: {
      register: (handlers) => {
        lifecycle = handlers
      }
    },
    requestMeter: {
      register(handler) {
        meter = handler
      }
    }
  } satisfies Pick<HarnessPorts, 'tools' | 'jobs' | 'lifecycle' | 'requestMeter'>
  const policy = 'host' in options ? createToolPolicy(options.host) : undefined
  const entries = 'host' in options ? install(registrations, options.host).entries : undefined
  if ('install' in options)
    options.install({
      ...bound({
        ended: false,
        context,
        commit: (run) => harness.commit(run, context),
        memo: async () => {
          throw new Error('Memory requires a call')
        }
      }),
      ...registrations,
      toolGate: {
        register: (handlers) => {
          customGate = handlers
        }
      },
      contextFilter: { register() {} }
    })
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
            (ports) =>
              tool.run(
                {
                  key: callKeyOf(String(api.taskId)),
                  thread: threadId(api.conversationId),
                  args: copyJson(args),
                  signal: callContext.abortSignal ?? new AbortController().signal
                },
                ports
              )
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
          if (!policy && !customGate) return
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
            : await customGate?.before(gated, view, gatePorts(api, callContext))
          if (!result) return
          return {
            block: result.block,
            arguments: result.args === undefined ? undefined : (nativeValue(result.args) as Record<string, NativeJson>)
          }
        },
        async afterTool(call, result, api, callContext) {
          if (!policy && !customGate) return
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
              : await customGate?.after(gated, span, gatePorts(api, callContext))
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
  return {
    extension,
    entries,
    withCall,
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
        await withCall(thread, (ports) => lifecycle?.onOpen(thread, { reopened: true }, ports) ?? Promise.resolve())
      }
      recovering = false
      unsubscribe = harness.observeCommits({
        advance(publication) {
          for (const change of publication.changes) {
            if (change.type !== 'entry' || !CompactionEntry.is(change.value)) continue
            const thread = threadId(change.value.conversationId)
            void withCall(thread, (ports) => lifecycle?.onCompacted(thread, ports) ?? Promise.resolve()).catch(
              options.onError ?? (() => {})
            )
          }
        },
        end() {}
      }).detach
    },
    async open(thread: ThreadId) {
      await withCall(thread, (ports) => lifecycle?.onOpen(thread, { reopened: false }, ports) ?? Promise.resolve())
    },
    async close() {
      unsubscribe?.()
      const onClose = lifecycle?.onClose
      if (onClose) {
        const conversations = await harness.commit(
          (tx) => pages((cursor) => tx.scanConversations({}, 256, cursor)),
          context
        )
        for (const conversation of conversations) {
          const thread = threadId(conversation.id)
          if (options.owns && !options.owns(thread)) continue
          await withCall(thread, (ports) => onClose(thread, ports))
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
