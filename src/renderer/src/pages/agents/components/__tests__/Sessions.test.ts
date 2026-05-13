import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { describe, expect, it } from 'vitest'

import { resolveCreateSessionAgentId } from '../Sessions'

const session = (id: string, agentId: string) => ({ id, agentId }) as AgentSessionEntity
const agent = (id: string) => ({ id }) as AgentEntity

describe('resolveCreateSessionAgentId', () => {
  it('prefers the active session agent', () => {
    expect(
      resolveCreateSessionAgentId([session('session-1', 'agent-1'), session('session-2', 'agent-2')], 'session-2', [
        agent('agent-3')
      ])
    ).toBe('agent-2')
  })

  it('falls back to the first session agent', () => {
    expect(resolveCreateSessionAgentId([session('session-1', 'agent-1')], 'missing-session', [agent('agent-2')])).toBe(
      'agent-1'
    )
  })

  it('falls back to the first agent when no sessions exist', () => {
    expect(resolveCreateSessionAgentId([], null, [agent('agent-1')])).toBe('agent-1')
  })
})
