import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { Effect, Step, TxOp } from '../core/decisions'
import type { ConversationFacts } from '../core/facts'
import type { ApprovalOutcome, CallInputs, HostSettingsSnapshot } from '../core/hostFacts'
import { subagentViews } from '../core/subagents/subagentLedger'
import type { BoundPorts, MessageResult, RetractResult, StartResult, TransactResult } from '../ports/harness'
import type { HostPorts, Settings } from '../ports/host'

/** The ports of one tool call, job run, lifecycle callback or host entry, with the host's. */
export type Context = { readonly ports: BoundPorts; readonly host: HostPorts }

/** A committed step after its effects ran, with what the ports answered for its start, retract and message effects. */
type Executed<R extends JsonValue> = TransactResult<R> & {
  readonly started?: StartResult
  readonly retracted?: RetractResult
  readonly messaged?: MessageResult
}

/** Design §7.2: drops each operation whose key the facts have seen or an earlier operation of the step carries. */
function dedupe<R extends JsonValue>(facts: ConversationFacts, decided: Step<R>): Step<R> {
  const seen = new Set<string>(facts.keysSeen)
  const ops: TxOp[] = []
  for (const op of decided.ops) {
    if (seen.has(op.key)) continue
    seen.add(op.key)
    ops.push(op)
  }
  return { ...decided, ops }
}

const touchesChildren = (decided: Step): boolean =>
  decided.ops.some(
    (op) => op.type === 'spawn-child' || (op.type === 'append-record' && op.record.type === 'subagent-run')
  ) || decided.effects.some((effect) => effect.type === 'stop-child' || effect.type === 'message-child')

async function execute(
  context: Context,
  effect: Exclude<Effect, { type: 'start-turn' | 'retract-turn' | 'message-child' }>
) {
  const { ports, host } = context
  switch (effect.type) {
    case 'stop-turn':
      return ports.turns.stop(effect.thread, effect.cause, effect.turn)
    case 'stop-child':
      return ports.helpers.stop(effect.child, effect.run)
    case 'emit':
      host.observation.emit(effect.event)
  }
}

/**
 * Design §7.1: decide inside one commit, then run the effects in order with no decision between them. A step that
 * spawned, recorded, messaged or stopped a child shows the host the thread's subagent views afterwards.
 */
export async function step<R extends JsonValue>(
  context: Context,
  thread: ThreadId,
  decide: (facts: ConversationFacts) => Step<R>
): Promise<Executed<R>> {
  let touched = false
  const committed = await context.ports.ledger.transact(thread, (facts) => {
    const decided = dedupe(facts, decide(facts))
    touched = touchesChildren(decided)
    return decided
  })
  let started: StartResult | undefined
  let retracted: RetractResult | undefined
  let messaged: MessageResult | undefined
  const { turns, helpers } = context.ports
  for (const effect of committed.effects) {
    if (effect.type === 'start-turn') started = await turns.start(effect.thread, effect.input, effect.key)
    else if (effect.type === 'retract-turn') retracted = await turns.retract(effect.thread, effect.key)
    else if (effect.type === 'message-child')
      messaged = await helpers.message(effect.child, effect.input, effect.key, effect.run)
    else await execute(context, effect)
  }
  if (touched) await emitViews(context, thread)
  return {
    ...committed,
    ...(started === undefined ? {} : { started }),
    ...(retracted === undefined ? {} : { retracted }),
    ...(messaged === undefined ? {} : { messaged })
  }
}

/** C3–C6, C14: each setting read once for one decision. */
const settingsSnapshot = (settings: Settings, thread: ThreadId): HostSettingsSnapshot => ({
  goalDefaults: settings.goalDefaults(),
  autonomy: settings.autonomy(),
  permissionMode: settings.permissionMode(thread),
  attendance: settings.attendance(thread),
  maxBackground: settings.maxBackground(),
  offloadThreshold: settings.offloadThreshold()
})

/** L6: the outcomes the host persisted for the thread's calls and for its children's, which show a child waiting. */
async function outcomesFor(host: HostPorts, facts: ConversationFacts): Promise<ApprovalOutcome[]> {
  const threads = [facts.thread, ...facts.children.keys()]
  const lists = await Promise.all(threads.map((thread) => host.approvals.outcomes(thread, [])))
  return lists.flat()
}

/** Design §7.1 point 1: the host facts one decision needs, gathered before its commit. */
export async function gatherInputs(
  context: Context,
  thread: ThreadId,
  extra: Pick<CallInputs, 'models' | 'verdict' | 'args'> = {}
): Promise<CallInputs> {
  const facts = await context.ports.ledger.read(thread)
  return {
    now: context.ports.clock.now(),
    settings: settingsSnapshot(context.host.settings, thread),
    approvals: await outcomesFor(context.host, facts),
    ...extra
  }
}

/** P7: the thread's background children as the host shows them, from fresh facts. */
export async function emitViews(context: Context, thread: ThreadId): Promise<void> {
  const facts = await context.ports.ledger.read(thread)
  const views = subagentViews(facts, await outcomesFor(context.host, facts))
  context.host.observation.emit({ type: 'subagents', thread, views })
}
