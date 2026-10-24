import { turnInput } from '../../core/decisions'
import type { ReportInput } from '../../core/driver/jobs'
import { callKeyOf } from '../../core/facts'
import { reportTarget } from '../../core/subagents/subagentDecisions'
import { readSubagents } from '../../core/subagents/subagentLedger'
import type { JobHandler } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { runChild } from '../childRuns'

/**
 * The `subagent-report` job (design §7.5): runs a background run to its end and records it. A rerun finds the same
 * message by key and the same wait; once the end is recorded (a stop before the first input included, G-C4) there is
 * nothing left to do.
 */
export function subagentReport(host: HostPorts): JobHandler {
  return async (ports, job) => {
    // `ensureReport` is the only writer of this job kind.
    const input = job.input as ReportInput
    const parent = job.scope
    const facts = await ports.ledger.read(parent)
    const target = reportTarget(facts, input)
    const origin = target && readSubagents(facts.history).find(({ child }) => child === target.child)
    if (!target || !origin) return
    const message = turnInput({ type: 'subagent-message' }, input.text)
    await runChild(
      { ports, host },
      parent,
      target.child,
      target.run,
      message,
      callKeyOf(origin.latest.parentToolCallId)
    )
  }
}
