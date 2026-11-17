import { ensureDriver } from '../core/driver/jobs'
import { decideOnOpen } from '../core/driver/lifecycle'
import { decideRunEnd } from '../core/subagents/subagentDecisions'
import { runReport } from '../core/subagents/subagentText'
import type { LifecycleHandlers } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { emitViews, gatherInputs, step } from './step'

/** H12: what the package does when a conversation opens, compacts and closes. */
export function lifecycleHandlers(host: HostPorts): LifecycleHandlers {
  return {
    // Reads, then the stops `decideOnOpen` asks for: no submit and no wait, so nothing resumes early on Durable.
    async onOpen(thread, open, ports) {
      const context = { ports, host }
      const inputs = await gatherInputs(context, thread)
      const { supportsTools } = await host.models.current(thread)
      await step(context, thread, (facts) => decideOnOpen(facts, inputs, { ...open, supportsTools }))
      // The host lost the views it showed, and a crash may have fallen between a step's commit and its views.
      if (open.reopened) await emitViews(context, thread)
    },
    async onChildOpenFailed(parent, child, error, ports) {
      const answer = { outcome: 'failed' as const, text: '', error }
      await step({ ports, host }, parent, (facts) => decideRunEnd(facts, child, 1, answer, runReport(answer)))
    },
    // The status a compaction leaves is written by the driver once the conversation is idle (S-i).
    async onCompacted(thread, ports) {
      await step({ ports, host }, thread, (facts) => ({ ops: [ensureDriver(facts)], effects: [], result: null }))
    },
    // S-f (a shutdown record for running children) comes with PR-3a.
    async onClose() {}
  }
}
