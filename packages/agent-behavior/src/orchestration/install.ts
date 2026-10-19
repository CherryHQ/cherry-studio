import { unadmittedRoundItems } from '../core/goal/goalHistory'
import { allowRequest } from '../core/subagents/subagentDecisions'
import type { HarnessPorts } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { type Entries, entries } from './entries'

/** What the host keeps from `install`: the entries it calls; every handler is registered on the harness. */
export type Installation = { readonly entries: Entries }

/** Design §3.3: registers the package's handlers on `harness`; call it at open and again after every restart. */
export function install(harness: HarnessPorts, host: HostPorts): Installation {
  harness.contextFilter.register({ omit: (_thread, facts) => unadmittedRoundItems(facts.history) })
  harness.requestMeter.register({ allow: (_thread, requestsInRun, lineage) => allowRequest(requestsInRun, lineage) })
  return { entries: entries(host) }
}
