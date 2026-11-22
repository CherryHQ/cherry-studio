import type { JobKind } from '../core/decisions'
import { unadmittedRoundItems } from '../core/goal/goalHistory'
import { allowRequest } from '../core/subagents/subagentDecisions'
import type { HarnessPorts, JobHandler } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { type Entries, entries } from './entries'
import { gateHandlers } from './gate'
import { idleDriver } from './jobs/idleDriver'
import { subagentReport } from './jobs/subagentReport'
import { lifecycleHandlers } from './lifecycle'
import { goalTools } from './tools/goal'
import { interactionTools } from './tools/interaction'
import { recallTool } from './tools/recall'
import { subagentTools } from './tools/subagents'

/** What the host keeps from `install`: the entries it calls; every handler is registered on the harness. */
export type Installation = { readonly entries: Entries }

export function behaviorHandlers(host: HostPorts) {
  return {
    tools: [...goalTools(host), ...subagentTools(host), ...interactionTools(host), recallTool()],
    jobs: new Map<JobKind, JobHandler>([
      ['idle-driver', idleDriver(host)],
      ['subagent-report', subagentReport(host)]
    ]),
    lifecycle: lifecycleHandlers(host),
    entries: entries(host)
  }
}

/** Design §3.3: registers the package's handlers on `harness`; call it at open and again after every restart. */
export function install(harness: HarnessPorts, host: HostPorts): Installation {
  const handlers = behaviorHandlers(host)
  for (const tool of handlers.tools) harness.tools.register(tool)
  harness.toolGate.register(gateHandlers(host))
  harness.contextFilter.register({ omit: (_thread, facts) => unadmittedRoundItems(facts) })
  harness.requestMeter.register({ allow: (_thread, requestsInRun, lineage) => allowRequest(requestsInRun, lineage) })
  for (const [kind, job] of handlers.jobs) harness.jobs.register(kind, job)
  harness.lifecycle.register(handlers.lifecycle)
  return { entries: handlers.entries }
}
