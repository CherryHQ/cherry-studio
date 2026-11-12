import { describe, expect, it } from 'vitest'

import { AGENT_COLOR_COUNT, getAgentColorIndex, getAgentColorStyle } from '../agentColor'

describe('agentColor', () => {
  it('keeps an agent on the same palette slot across calls', () => {
    expect(getAgentColorIndex('agent-alpha')).toBe(getAgentColorIndex('agent-alpha'))
  })

  it('keeps every index inside the palette', () => {
    for (let i = 0; i < 200; i++) {
      const index = getAgentColorIndex(`agent-${i}`)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(AGENT_COLOR_COUNT)
    }
  })

  it('spreads distinct agents across more than one palette slot', () => {
    const slots = new Set(Array.from({ length: 40 }, (_, i) => getAgentColorIndex(`agent-${i}`)))
    expect(slots.size).toBeGreaterThan(1)
  })

  it('points the accent at the palette variable chosen for the agent', () => {
    const style = getAgentColorStyle('agent-alpha') as Record<string, string>
    expect(style['--agent-accent']).toBe(`var(--agent-color-${getAgentColorIndex('agent-alpha')})`)
  })
})
