// Catches a port that no adapter can implement through the public barrel: a member type the barrel does not export,
// or a signature no implementation can satisfy. Checked by the package typecheck.
import type { GateHandlers, HarnessPorts, HostPorts } from '../../src'

const unused = (): Promise<never> => Promise.reject(new Error('unused'))
const register = (): void => {}

export const harness: HarnessPorts = {
  ledger: { read: unused, transact: unused, modelContext: unused },
  turns: { start: unused, retract: unused, stop: unused },
  helpers: { message: unused, awaitAnswer: unused, stop: unused },
  jobs: { register },
  waits: { untilIdle: unused, untilRunEnd: unused },
  memory: { remember: unused },
  clock: { now: () => 0 },
  tools: { register },
  toolGate: { register },
  contextFilter: { register },
  requestMeter: { register },
  lifecycle: { register }
}
export const host: HostPorts = {
  approvals: { facts: unused, ask: unused, outcomes: unused },
  questions: { ask: unused },
  models: { find: unused, current: unused },
  verifier: { verify: unused },
  outputStore: { save: unused },
  summarizer: { summarize: unused },
  observation: { emit: () => {} },
  settings: {
    goalDefaults: () => ({ maxGoalRounds: 1, maxGoalRoundsCeiling: 1, blockedAfter: 1 }),
    autonomy: () => 'auto',
    permissionMode: () => 'default',
    attendance: () => 'unavailable',
    maxBackground: () => 0,
    offloadThreshold: () => 0
  }
}
// `after` gets the call's `nested` flag, as `before` does.
export const gate: GateHandlers = { before: unused, after: async (call, result) => (call.nested ? undefined : result) }
