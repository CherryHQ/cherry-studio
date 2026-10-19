import { summaryDecision } from '../core/context/offload'
import { ensureDriver } from '../core/driver/jobs'
import { decideOnOpen } from '../core/driver/lifecycle'
import { keys } from '../core/keys'
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
    async onCompacting(thread, request, ports) {
      const { key, signal, ...summarize } = request
      try {
        const summary = await ports.memory.remember(keys.summaryMemo(key), async () => {
          const decided = summaryDecision(await host.summarizer.summarize({ ...summarize, thread }, signal))
          // A decline is not kept: a retry of the same compaction asks the host again.
          if ('decline' in decided) throw new Error('The summary is empty')
          return decided.summary
        })
        return { summary }
      } catch (error) {
        // D33: a failed summary cancels the compaction; nothing falls back to the conversation's model.
        return { decline: true, reason: error instanceof Error ? error.message : String(error) }
      }
    },
    // The status a compaction leaves is written by the driver once the conversation is idle (S-i).
    async onCompacted(thread, ports) {
      await step({ ports, host }, thread, (facts) => ({ ops: [ensureDriver(facts)], effects: [], result: null }))
    },
    // S-f (a shutdown record for running children) comes with PR-3a.
    async onClose() {}
  }
}
