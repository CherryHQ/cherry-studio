import type { TSchema } from '@earendil-works/pi-ai'
import type { ExtensionFactory, ToolDefinition as NativeTool } from '@earendil-works/pi-coding-agent'

import type { ToolDefinition } from '@cherrystudio/agent-behavior'
import type { JsonValue } from '@cherrystudio/agent-runtime'

import { callKeyFor } from './history'
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
