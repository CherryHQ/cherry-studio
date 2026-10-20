import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type TSchema
} from '@earendil-works/pi-ai'
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
  type CompactionRequest,
  ENTRY_KINDS,
  type GateCall,
  type GateFacts,
  type RequestAllowance,
  type ToolCallFact,
  type ToolDefinition,
  type ToolResultFact
} from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'

import type { CompactionSummarizer } from '../compaction'
import { zeroUsage } from '../subagentRun'
import { BLOCKED_PREFIX, callKeyFor, historyOf, latestPlan, omittedMarkers, textOf, withoutMarkers } from './history'
import { readFacts } from './ledger'
import { endingOf, finishRun, noteMessage, offerSteer } from './runs'
import type { Adapter, Conversation } from './state'

const UNWIRED_SUMMARIZER =
  "Compaction cancelled: the session's compaction.summarize is not the adapter's summarize, so onCompacting was not asked"

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
    // H12: after the summarizer extension's handler; a compaction that bypassed the adapter's summarizer never asked
    // `onCompacting` (the host left out `compaction.summarize` or passed its own), so it is cancelled.
    pi.on('session_before_compact', () => {
      if (conv.summarized) {
        conv.summarized = false
        return undefined
      }
      adapter.report(new Error(`${UNWIRED_SUMMARIZER} (${conv.thread})`))
      return { cancel: true }
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
        const args = structuredClone(event.input) as JsonValue
        const call: ToolCallFact = { callId: event.toolCallId, callKey: key, name: event.toolName, args }
        if (run && !nested) run.window.push(call)
        const gate = adapter.installation.gate
        if (!gate) return undefined
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
        return undefined
      })
    )
    pi.on(
      'tool_result',
      reporting(adapter, async (event: ToolResultEvent) => {
        const gate = adapter.installation.gate
        if (!gate) return undefined
        const result: ToolResultFact = {
          text: textOf(event.content),
          isError: event.isError,
          ...(event.details === undefined ? {} : { details: event.details as JsonValue })
        }
        // The call `before` saw, with the arguments it ran with (GateHandlers.after).
        const gated: GateCall = {
          key: callKeyFor(conv.thread, event.toolCallId),
          thread: conv.thread,
          tool: event.toolName,
          args: event.input as JsonValue,
          nested: event.parentToolCallId !== undefined
        }
        const replaced = await gate.after(gated, result, adapter.gatePorts)
        if (!replaced) return undefined
        // A result fact is text and details: images pass through; Pi drops the replaced content's structured content.
        return {
          content: [{ type: 'text', text: replaced.text }, ...event.content.filter((part) => part.type === 'image')],
          isError: replaced.isError,
          details: replaced.details
        }
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
    parameters: tool.schema as unknown as TSchema,
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
  return adapter.installation.meter?.allow(conv.thread, requestsInRun, lineage) ?? { ok: true }
}

/** H11: the meter decides before each model request of a run; a refusal fails the request before it goes out. */
export function meterRequests(adapter: Adapter, conv: Conversation, session: AgentSession): void {
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    const run = conv.active
    const allowance = allow(adapter, conv, run?.requests ?? 0)
    if (!allowance.ok) {
      if (run) run.refused = allowance.text
      return refusal(model, allowance.text)
    }
    if (run) run.requests += 1
    return stream(model, context, options)
  }
}

/**
 * H12: every compaction asks `onCompacting` first, and one during a run is one of its metered requests (H11). What it
 * throws cancels the compaction and becomes its `compaction-end` error: a decline's reason or a refusal's text.
 */
export function compactionSummarizer(adapter: Adapter, conv: Conversation): CompactionSummarizer {
  const decline = (reason: string): never => {
    conv.declined = true
    throw new Error(reason)
  }
  return async (request) => {
    conv.summarized = true
    conv.declined = false
    const run = conv.active
    if (run) {
      const allowance = allow(adapter, conv, run.requests)
      if (!allowance.ok) return decline(allowance.text)
      run.requests += 1
    }
    const handlers = adapter.installation.lifecycle
    if (!handlers) throw new Error('No onCompacting handler is registered')
    const compaction: CompactionRequest = {
      // The entry the compaction will follow: Pi appends it after the branch's last entry.
      key: `${conv.thread}:${conv.manager.getLeafId()}`,
      reason: request.reason,
      messages: JSON.parse(JSON.stringify(request.messages)) as JsonValue[],
      ...(request.previousSummary === undefined ? {} : { previousSummary: request.previousSummary }),
      ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
      signal: request.signal
    }
    const verdict = await handlers.onCompacting(conv.thread, compaction, adapter.gatePorts).catch((error: unknown) => {
      // A host compact() rejects (the compaction is cancelled); an automatic compaction has no caller.
      if (conv.hostCompacts === 0) adapter.report(error)
      throw error
    })
    return 'decline' in verdict ? decline(verdict.reason) : verdict.summary
  }
}

function refusal(model: Model<Api>, text: string): AssistantMessageEventStream {
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: 'error',
    errorMessage: text,
    timestamp: Date.now()
  }
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'error', reason: 'error', error: message })
  stream.end(message)
  return stream
}
