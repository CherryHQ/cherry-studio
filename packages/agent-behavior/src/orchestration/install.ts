import { unadmittedRoundItems } from '../core/goal/goalHistory'
import { allowRequest } from '../core/subagents/subagentDecisions'
import type { HarnessPorts } from '../ports/harness'
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

/** Design §3.3: registers the package's handlers on `harness`; call it at open and again after every restart. */
export function install(harness: HarnessPorts, host: HostPorts): Installation {
  for (const tool of [...goalTools(host), ...subagentTools(host), ...interactionTools(host), recallTool()])
    harness.tools.register(tool)
  harness.toolGate.register(gateHandlers(host))
  harness.contextFilter.register({ omit: (_thread, facts) => unadmittedRoundItems(facts) })
  harness.requestMeter.register({ allow: (_thread, requestsInRun, lineage) => allowRequest(requestsInRun, lineage) })
  harness.jobs.register('idle-driver', idleDriver(host))
  harness.jobs.register('subagent-report', subagentReport(host))
  harness.lifecycle.register(lifecycleHandlers(host))
  return { entries: entries(host) }
}
