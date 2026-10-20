import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { fieldsOf, stringField } from '../../core/args'
import type { ModelFacts } from '../../core/hostFacts'
import type { Key } from '../../core/keys'
import {
  decideMessage,
  decideSpawn,
  decideSteerWithdrawn,
  decideStop,
  stoppedResult
} from '../../core/subagents/subagentDecisions'
import { continuedText, notDeliveredText, startedText } from '../../core/subagents/subagentText'
import type { ToolCall, ToolDefinition, ToolOutcome, TransactResult } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { runChild, SUBAGENT_TOOL_NAME } from '../childRuns'
import { type Context, gatherInputs, step } from '../step'

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.',
  '- Run it in the foreground when you need its result to go on. Use background: true only when you have independent work to do meanwhile; you are notified when it finishes.'
].join('\n')
const ID = { type: 'string', description: 'The id a subagent result or notification gave.' }
const SPAWN_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'A short (3-5 word) title of the task, shown to the user.' },
    prompt: { type: 'string', description: 'The task for the subagent.' },
    fork: {
      type: 'boolean',
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    },
    background: {
      type: 'boolean',
      description:
        'Return at once and let the subagent work in the background; you are notified when it finishes. Default false.'
    },
    model: {
      type: 'string',
      description:
        'Only when the user (or the agent instructions) names a model for this task: the name as they said it, with the provider if they gave one, e.g. "OpenRouter Claude Sonnet 4.5". Leave it out otherwise.'
    }
  },
  required: ['description', 'prompt']
}
const MESSAGE_SCHEMA = {
  type: 'object',
  properties: { id: ID, message: { type: 'string', description: 'What to tell the subagent.' } },
  required: ['id', 'message']
}
// Subagents cannot start or manage subagents: a child conversation never gets these tools.
const SUBAGENT_TOOL = {
  replay: 'safe',
  executionMode: 'parallel',
  availability: 'parent-only',
  modelOnly: true
} as const

/** C7, C8: the conversation's model facts; candidates only for a model the call names. */
async function modelFacts(host: HostPorts, thread: ThreadId, query: string | undefined): Promise<ModelFacts> {
  const [candidates, { parentModelKey, defaultChildModelKey }] = await Promise.all([
    query ? host.models.find(query) : [],
    host.models.current(thread)
  ])
  return { candidates, parentModelKey, defaultChildModelKey }
}

/** The child the commit created under `key` (H1 reports every spawn it applied). */
function spawnedChild(spawned: TransactResult<JsonValue>['spawned'], key: Key): ThreadId {
  const found = spawned.find((entry) => entry.key === key)
  if (!found) throw new Error(`The commit reported no child spawned under ${key}`)
  return found.child
}

/** D15, D25: a background child reports through its job; a foreground one is messaged and awaited in the call (L4). */
async function spawn(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const named = stringField(fieldsOf(call.args), 'model')?.trim() || undefined
  const models = await modelFacts(context.host, call.thread, named)
  const inputs = await gatherInputs(context, call.thread, { args: call.args, models })
  const executed = await step(context, call.thread, (facts) => decideSpawn(facts, inputs, call.key))
  const decision = executed.result
  if (decision.kind === 'refused') return { text: decision.text, isError: true }
  const child = decision.child ?? spawnedChild(executed.spawned, decision.key)
  if (decision.background)
    return {
      text: startedText(child),
      isError: false,
      details: { sessionId: child, fork: decision.fork, background: true }
    }
  return runChild(context, call.thread, child, 1, decision.input, call.key)
}

/** D17, S-j: a running child reads the message after its step; a finished one continues in the background. */
async function message(context: Context, call: ToolCall): Promise<ToolOutcome> {
  for (;;) {
    const inputs = await gatherInputs(context, call.thread, { args: call.args })
    const executed = await step(context, call.thread, (facts) => decideMessage(facts, inputs, call.key))
    const decision = executed.result
    switch (decision.kind) {
      case 'refused':
        return { text: decision.text, isError: true }
      case 'queued':
        if (executed.messaged?.status === 'withdrawn') {
          await step(context, call.thread, (facts) => decideSteerWithdrawn(facts, call.key))
          // H3: the turn stopped and its call withdrew the steer; the child runs on, so deciding again would steer it.
          if (call.signal.aborted) return { text: notDeliveredText(decision.child), isError: true }
          // G-C5: the run ended before it took the steer, which started nothing; continue the child instead.
          continue
        }
        return { text: decision.text, isError: false, details: { sessionId: decision.child, continued: false } }
      case 'continued': {
        const child = decision.child ?? spawnedChild(executed.spawned, decision.key)
        return {
          text: continuedText(decision.from, child),
          isError: false,
          details: { sessionId: child, continued: true }
        }
      }
      case 'stopping':
        // Y5: the run is being stopped; once it ended, decide again.
        await context.ports.helpers.awaitAnswer(decision.child, decision.run, decision.key)
    }
  }
}

/** D18: the model gets the partial output; no notification follows. */
async function stop(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const inputs = await gatherInputs(context, call.thread, { args: call.args })
  const decision = (await step(context, call.thread, (facts) => decideStop(facts, inputs))).result
  if (decision.kind === 'refused') return { text: decision.text, isError: true }
  if (decision.kind === 'not-running' || decision.kind === 'ended') return decision.result
  const answer = await context.ports.helpers.awaitAnswer(decision.child, decision.run, decision.key)
  return stoppedResult(decision.child, decision.run, answer)
}

/** `subagent`, `message_subagent` (replay-safe) and `stop_subagent` (unsafe: a rerun could stop later work). */
export function subagentTools(host: HostPorts): ToolDefinition[] {
  return [
    {
      ...SUBAGENT_TOOL,
      name: SUBAGENT_TOOL_NAME,
      description: DESCRIPTION,
      schema: SPAWN_SCHEMA,
      run: (call, ports) => spawn({ ports, host }, call)
    },
    {
      ...SUBAGENT_TOOL,
      name: 'message_subagent',
      description:
        'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step.',
      schema: MESSAGE_SCHEMA,
      run: (call, ports) => message({ ports, host }, call)
    },
    {
      ...SUBAGENT_TOOL,
      name: 'stop_subagent',
      replay: 'unsafe',
      description:
        'Stop a running subagent by its id and get its partial output. You get no notification for it afterwards; message_subagent can continue it later.',
      schema: { type: 'object', properties: { id: ID }, required: ['id'] },
      run: (call, ports) => stop({ ports, host }, call)
    }
  ]
}
