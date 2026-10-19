import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type TSchema
} from '@earendil-works/pi-ai'
import type { AgentSession, ExtensionFactory, ToolDefinition as NativeTool } from '@earendil-works/pi-coding-agent'

import {
  ENTRY_KINDS,
  type GateCall,
  type GateFacts,
  type RequestAllowance,
  type ToolCallFact,
  type ToolDefinition,
  type ToolResultFact
} from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'

import { zeroUsage } from '../subagentRun'
import { BLOCKED_PREFIX, callKeyFor, historyOf, latestPlan, omittedMarkers, textOf, withoutMarkers } from './history'
import { readFacts } from './ledger'
import { endingOf, finishRun, flushHeld, noteMessage } from './runs'
import type { Adapter, Conversation } from './state'

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
      if (!run) return
      run.pending = false
      // Pi drops an abort made before it started the run (a prompt's input handlers); repeat it now.
      if (run.stopRequested) ctx.abort()
    })
    pi.on('turn_start', () => flushHeld(conv))
    pi.on('message_end', (event) => noteMessage(conv, event.message))
    pi.on('agent_settled', (event) => {
      if (conv.active && !conv.active.pending) finishRun(adapter, conv, endingOf(conv.active, event.aborted))
    })
    pi.on('context', (event) => {
      const filter = adapter.installation.filter
      if (!filter) return undefined
      const omit = filter.omit(conv.thread, readFacts(adapter, conv.thread))
      if (omit.length === 0) return undefined
      return { messages: withoutMarkers(event.messages, omittedMarkers(conv.manager.getBranch(), omit)) }
    })
    pi.on('tool_call', async (event) => {
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
        lineage: conv.lineage,
        plan: latestPlan(historyOf(conv.manager.getBranch(), conv.thread)),
        goalRound,
        callWindow: goalRound && run ? [...run.window] : []
      }
      const gated: GateCall = { key, thread: conv.thread, tool: event.toolName, args, nested }
      const verdict = await gate.before(gated, facts, adapter.gatePorts)
      if (verdict.block !== undefined) return { block: true, reason: `${BLOCKED_PREFIX}${verdict.block}` }
      if (verdict.args !== undefined) replaceArgs(event.input, verdict.args)
      return undefined
    })
    pi.on('tool_result', async (event) => {
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
      // A result fact is text and details; images and structured content pass through.
      return {
        content: [{ type: 'text', text: replaced.text }, ...event.content.filter((part) => part.type === 'image')],
        isError: replaced.isError,
        details: replaced.details,
        structuredContent: event.structuredContent
      }
    })
    pi.on('session_shutdown', () => adapter.lifecycle((handlers, ports) => handlers.onClose(conv.thread, ports)))
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
      const outcome = await adapter.withScope(owner, (ports) => tool.run(call, ports))
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

/**
 * H11: the meter decides before each model request of a run, with the conversation's lineage; a refusal fails the
 * request before it goes out. A host summarizer's requests bypass it and are not counted yet (G5).
 */
export function meterRequests(adapter: Adapter, conv: Conversation, session: AgentSession): void {
  const stream = session.agent.streamFunction
  const lineage = conv.lineage.kind === 'subagent' ? 'child' : 'root'
  session.agent.streamFunction = (model, context, options) => {
    const run = conv.active
    const allowance: RequestAllowance = adapter.installation.meter?.allow(conv.thread, run?.requests ?? 0, lineage) ?? {
      ok: true
    }
    if (!allowance.ok) {
      if (run) run.refused = allowance.text
      return refusal(model, allowance.text)
    }
    if (run) run.requests += 1
    return stream(model, context, options)
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
