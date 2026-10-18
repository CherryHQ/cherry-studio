import type { PortMethod } from '../ports/harness'

/** The harness port methods at run time; `tests/contract/coverage.test.ts` checks it against `PortMethod`. */
export const HARNESS_PORT_METHODS = [
  'ledger.read',
  'ledger.transact',
  'ledger.modelContext',
  'turns.start',
  'turns.retract',
  'turns.stop',
  'helpers.message',
  'helpers.awaitAnswer',
  'helpers.stop',
  'jobs.register',
  'waits.untilIdle',
  'waits.untilTurnEnd',
  'memory.remember',
  'clock.now',
  'tools.register',
  'toolGate.register',
  'contextFilter.register',
  'requestMeter.register',
  'lifecycle.register'
] as const satisfies readonly PortMethod[]
