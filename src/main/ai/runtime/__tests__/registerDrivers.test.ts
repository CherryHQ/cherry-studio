import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'
import { afterEach, describe, expect, it } from 'vitest'

import { registerRuntimeDrivers } from '../registerDrivers'
import { runtimeDriverRegistry } from '../registry'

describe('registerRuntimeDrivers', () => {
  afterEach(() => {
    runtimeDriverRegistry.clearForTest()
  })

  // Guards the descriptor↔registry pairing: a merge that drops a driver
  // registration (as happened to pi in the barrel refactor) fails here
  // instead of at session-open time.
  it('registers an agent-session driver for every AgentType in AGENT_RUNTIME_CAPABILITIES', () => {
    registerRuntimeDrivers()
    const types = Object.keys(AGENT_RUNTIME_CAPABILITIES) as AgentType[]
    for (const type of types) {
      expect(runtimeDriverRegistry.getAgentSessionDriver(type), `missing driver for agent type "${type}"`).toBeDefined()
    }
  })
})
