import { lazyStream } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  ContextEvent,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition as NativeTool,
  ToolCallEvent,
  ToolResultEvent
} from '@earendil-works/pi-coding-agent'

import {
  ENTRY_KINDS,
  encodeEntry,
  goalForRequest,
  nativeSummaryKey,
  type GateCall,
  type GateFacts,
  type RequestAllowance,
  type ToolCallFact,
  type ToolDefinition,
  type ToolResultFact
} from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'

import {
  addUsage,
  ZERO_USAGE,
  BLOCKED_PREFIX,
  callKeyFor,
  historyOf,
  latestPlan,
  omittedMarkers,
  textOf,
  usageFact,
  withoutMarkers
} from './history'
import { readFacts } from './ledger'
import { PI_RUN_LIMIT, PI_RUN_LIMIT_MESSAGE, recordRunRefusal } from './runBudget'
import { endingOf, finishRun, noteMessage, offerSteer, resetRunBudget } from './runs'
import type { Adapter, Conversation } from './state'

type AgentTurnDecision = Exclude<Awaited<ReturnType<NonNullable<AgentSession['agent']['finishTurn']>>>, void>

/** The adapter's side of one conversation's session: the package's tools, run boundaries and inbound handlers. */
export function conversationExtension(adapter: Adapter, conv: Conversation): ExtensionFactory {
  return (pi) => {
    for (const tool of adapter.installation.tools.values()) {
      // H8, README "Applying a step": a child gets the parent's tools filtered by `availability`, never by name.
      if (conv.lineage.kind === 'subagent' && tool.availability === 'parent-only') continue
      pi.registerTool(nativeTool(adapter, conv, tool))
    }
    pi.on('agent_start', (_event, ctx) => {
      const run = conv.active
      // README host obligations: only the adapter starts runs here; this one has no input, run number or end.
      if (!run) {
        adapter.report(new Error(`A run the behavior adapter did not start began in ${conv.thread}`))
        return
      }
      run.pending = false
      // Pi drops an abort made before it started the run (a prompt's input handlers); repeat it now.
      if (run.stopRequested) ctx.abort()
    })
    pi.on('session_before_compact', () => {
      const owner = goalForRequest(historyOf(conv.manager.getBranch(), conv.thread))
      const key = `${conv.thread}:${conv.manager.getLeafId()}`
      conv.summary = { owner, key, ...(conv.active && { run: conv.active.run }), requests: 0 }
      conv.manager.appendCustomEntry('cherry.native-compaction-owner', {
        ...owner,
        key: nativeSummaryKey(key),
        usage: ZERO_USAGE,
        nativeThread: conv.thread,
        ...(conv.active && { nativeRun: conv.active.run })
      })
    })
    pi.on('turn_end', (event) => offerSteer(conv, event.message))
    pi.on('message_end', (event) => noteMessage(conv, event.message))
    pi.on('agent_settled', (event) => {
      if (conv.active && !conv.active.pending) finishRun(adapter, conv, endingOf(conv.active, event.aborted))
    })
    pi.on(
      'context',
      reporting(adapter, (event: ContextEvent) => {
        const filter = adapter.installation.filter
        if (!filter) return undefined
        const omit = filter.omit(conv.thread, readFacts(adapter, conv.thread))
        if (omit.length === 0) return undefined
        return { messages: withoutMarkers(event.messages, omittedMarkers(conv.manager.getBranch(), omit)) }
      })
    )
    pi.on(
      'tool_call',
      reporting(adapter, async (event: ToolCallEvent, ctx: ExtensionContext) => {
        const run = conv.active
        const nested = event.parentToolCallId !== undefined
        const key = callKeyFor(conv.thread, event.toolCallId)
        conv.callIds.set(key, event.toolCallId)
        const args = structuredClone(event.input) as JsonValue
        const call: ToolCallFact = { callId: event.toolCallId, callKey: key, name: event.toolName, args }
        if (run && !nested) run.window.push(call)
        const budgetedRun = !nested && conv.lineage.kind === 'root' ? run : undefined
        const refuseAtLimit = () => {
          if (!budgetedRun || budgetedRun.admissions < PI_RUN_LIMIT) return undefined
          budgetedRun.refused = PI_RUN_LIMIT_MESSAGE
          return { block: true, terminate: true, reason: PI_RUN_LIMIT_MESSAGE } as const
        }
        // Do not prompt once exhausted. Recheck after async policy approval, since a
        // concurrent batch can finish several approvals before any call executes.
        const refusal = refuseAtLimit()
        if (refusal) return refusal
        const gate = adapter.installation.gate
        if (!gate) {
          if (budgetedRun) budgetedRun.admissions += 1
          return undefined
        }
        const goalRound = run?.startedBy === ENTRY_KINDS.goalRound
        const facts: GateFacts = {
          plan: latestPlan(historyOf(conv.manager.getBranch(), conv.thread)),
          goalRound,
          callWindow: goalRound && run ? [...run.window] : []
        }
        // H9: the run's abort signal, which aborts when the call's turn stops.
        const signal = ctx.signal ?? new AbortController().signal
        const gated = { key, thread: conv.thread, tool: event.toolName, args, nested, signal }
        const verdict = await gate.before(gated, facts, adapter.gatePorts)
        if (verdict.block !== undefined) return { block: true, reason: `${BLOCKED_PREFIX}${verdict.block}` }
        if (verdict.args !== undefined) replaceArgs(event.input, verdict.args)
        const postApprovalRefusal = refuseAtLimit()
        if (postApprovalRefusal) return postApprovalRefusal
        if (budgetedRun) budgetedRun.admissions += 1
        return undefined
      })
    )
    pi.on(
      'tool_result',
      reporting(adapter, async (event: ToolResultEvent) => {
        const gate = adapter.installation.gate
        if (!gate) return undefined
        const gated: GateCall = {
          key: callKeyFor(conv.thread, event.toolCallId),
          thread: conv.thread,
          tool: event.toolName,
          args: event.input as JsonValue,
          nested: event.parentToolCallId !== undefined
        }
        const content: ToolResultEvent['content'] = []
        let changed = false
        let isError = event.isError
        let details = event.details
        for (let i = 0; i < event.content.length;) {
          const part = event.content[i]
          if (part.type !== 'text') {
            content.push(part)
            i++
            continue
          }
          const span: ToolResultEvent['content'] = []
          while (i < event.content.length && event.content[i].type === 'text') span.push(event.content[i++])
          const result: ToolResultFact = {
            text: textOf(span),
            isError,
            ...(details === undefined ? {} : { details: details as JsonValue })
          }
          const replaced = await gate.after(gated, result, adapter.gatePorts)
          if (!replaced) content.push(...span)
          else {
            changed = true
            content.push({ type: 'text', text: replaced.text })
            isError = replaced.isError
            details = replaced.details
          }
        }
        return changed ? { content, isError, details, structuredContent: event.structuredContent } : undefined
      })
    )
    pi.on(
      'session_shutdown',
      reporting(adapter, () => adapter.lifecycle((handlers, ports) => handlers.onClose(conv.thread, ports)))
    )
  }
}

/** Pi puts what a handler throws on its extension error channel and carries on; the host hears of it in `onError`. */
function reporting<E, C, R>(
  adapter: Adapter,
  handler: (event: E, ctx: C) => R | Promise<R>
): (event: E, ctx: C) => Promise<R> {
  return async (event, ctx) => {
    try {
      return await handler(event, ctx)
    } catch (error) {
      adapter.report(error)
      throw error
    }
  }
}

/** H8 coding-agent: `pi.registerTool` with the same name, schema and execution mode. */
function nativeTool(adapter: Adapter, conv: Conversation, tool: ToolDefinition): NativeTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.schema as object,
    executionMode: tool.executionMode,
    exposure: 'model-only',
    async execute(toolCallId, params, signal) {
      const owner = conv.active && { thread: conv.thread, run: conv.active.run }
      const call = {
        key: callKeyFor(conv.thread, toolCallId),
        thread: conv.thread,
        args: params as JsonValue,
        signal: signal ?? new AbortController().signal
      }
      const outcome = await adapter.withScope({ owner, signal: call.signal }, (ports) => tool.run(call, ports))
      return {
        content: [{ type: 'text', text: outcome.text }],
        details: outcome.details,
        ...(outcome.isError ? { isError: true } : {})
      }
    }
  }
}

/** A rewrite replaces the arguments in place: Pi runs the call with the object its `tool_call` handlers saw. */
function replaceArgs(input: Record<string, unknown>, args: JsonValue): void {
  if (typeof args !== 'object' || args === null || Array.isArray(args))
    throw new TypeError('A gate can only rewrite tool arguments to an object')
  for (const field of Object.keys(input)) delete input[field]
  Object.assign(input, args)
}

/** H11: the meter's answer for the next request of `conv`'s run, with the conversation's lineage. */
function allow(adapter: Adapter, conv: Conversation, requestsInRun: number): RequestAllowance {
  const lineage = conv.lineage.kind === 'subagent' ? 'child' : 'root'
  if (lineage === 'root' && requestsInRun >= PI_RUN_LIMIT) return { ok: false, text: PI_RUN_LIMIT_MESSAGE }
  return adapter.installation.meter?.allow(conv.thread, requestsInRun, lineage) ?? { ok: true }
}

/** H11: the meter decides before each model request of a run; a refusal fails the request before it goes out. */
export function meterRequests(adapter: Adapter, conv: Conversation, session: AgentSession): void {
  const prepare = session.agent.prepareNextTurnWithContext
  if (prepare)
    session.agent.prepareNextTurnWithContext = async (turn, signal) => {
      const run = conv.active
      // Pi prepares (and may compact) before it places the queued follow-up. Reset
      // first so that compaction is charged to the new input, not the completed one.
      if (
        run &&
        conv.lineage.kind === 'root' &&
        run.refused === undefined &&
        turn.message.stopReason === 'stop' &&
        !turn.message.content.some((part) => part.type === 'toolCall') &&
        session.getFollowUpMessages().length > 0
      )
        resetRunBudget(run)
      return prepare(turn, signal)
    }
  const finishTurn = session.agent.finishTurn
  session.agent.finishTurn = async (turn, signal): Promise<AgentTurnDecision | undefined> => {
    const decision = (await finishTurn?.(turn, signal)) ?? undefined
    const run = conv.active
    if (run) run.settlementReply = turn.message
    const refused = run?.refused
    if (refused === undefined) return decision
    recordRunRefusal(turn.message, refused)
    // Pi's per-call terminate flag stops only an entirely refused batch. Enforce the
    // run boundary here, after every admitted call has finished, including mixed batches.
    return { action: 'end' }
  }
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    const run = conv.active
    const allowance =
      run?.refused === undefined ? allow(adapter, conv, run?.requests ?? 0) : { ok: false as const, text: run.refused }
    if (!allowance.ok) {
      if (run) {
        run.refused = allowance.text
        // Native overflow recovery may ask for a summary after finishTurn. Keep
        // the refusal on the exact response that will settle this input.
        if (run.settlementReply) recordRunRefusal(run.settlementReply, allowance.text)
      }
      return lazyStream(model, async () => {
        throw new Error(allowance.text)
      })
    }
    if (run) run.requests += 1
    const summary = session.isCompacting ? conv.summary : undefined
    const output = stream(model, context, summary ? { ...options, sessionId: conv.thread } : options)
    if (!summary) return output
    return Promise.resolve(output).then((output) => {
      const key = nativeSummaryKey(`${summary.key}:${++summary.requests}`)
      const result = output.result.bind(output)
      let saved: ReturnType<typeof result> | undefined
      output.result = () =>
        (saved ??= result().then((message) => {
          const usage = usageFact(message.usage)
          const encoded = encodeEntry({ type: 'summary-usage', value: { ...summary.owner, usage } }, key)
          if (!encoded.data || typeof encoded.data !== 'object' || Array.isArray(encoded.data))
            throw new Error('Invalid native summary accounting')
          conv.manager.appendCustomEntry(encoded.kind, {
            ...encoded.data,
            nativeThread: conv.thread,
            ...(summary.run === undefined ? {} : { nativeRun: summary.run })
          })
          if (summary.run)
            conv.runUsage[summary.run - 1] = addUsage(conv.runUsage[summary.run - 1] ?? ZERO_USAGE, usage)
          return message
        }))
      return output
    })
  }
}
