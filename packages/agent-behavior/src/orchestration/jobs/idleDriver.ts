import type { ThreadId } from '@cherrystudio/agent-runtime'

import { admitRound, decideAtIdle } from '../../core/driver/idle'
import type { RoundDetails } from '../../core/facts'
import type { Key } from '../../core/keys'
import type { JobHandler } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { type Context, gatherInputs, step } from '../step'

/** R1: a round `Turns` took counts if the goal is still the one it was reserved for; otherwise it is withdrawn. */
async function admit(context: Context, thread: ThreadId, start: { readonly round: RoundDetails; readonly key: Key }) {
  const inputs = await gatherInputs(context, thread)
  const admitted = await step(context, thread, (facts) => admitRound(facts, inputs, start))
  if (admitted.retracted === 'already-started') await context.ports.turns.stop(thread, 'goal-withdraw')
}

/**
 * The `idle-driver` job (D38, H4): once the conversation has no run, one decision. A round or a notification that
 * `Turns` refused as busy recorded nothing and goes back to waiting; one it took is waited for until it has run, since
 * deciding before that would see the same facts. `done` wrote the driver's exit record in its own commit, so the job
 * ends there.
 */
export function idleDriver(host: HostPorts): JobHandler {
  return async (ports, job) => {
    const context = { ports, host }
    const thread = job.scope
    for (;;) {
      await ports.waits.untilIdle(thread)
      const inputs = await gatherInputs(context, thread)
      const decided = await step(context, thread, (facts) => decideAtIdle(facts, inputs))
      const decision = decided.result
      if (decision.kind === 'done') return
      const start = decided.effects.find((effect) => effect.type === 'start-turn')
      if (start?.type !== 'start-turn' || decided.started === 'busy') continue
      if (decision.kind === 'start-round') await admit(context, thread, decision)
      // Queued behind a failed run's leftovers, the input may run much later (G-C3).
      await ports.waits.untilDone(thread, start.key)
    }
  }
}
