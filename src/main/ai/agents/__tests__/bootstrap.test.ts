import { describe, expect, it } from 'vitest'

import { buildBootstrapInstructions } from '../bootstrap'

describe('buildBootstrapInstructions', () => {
  describe('when the agent already has a configured name', () => {
    it.each([true, false])('skips the naming flow (hasAgentInstructions: %s)', (hasAgentInstructions) => {
      const prompt = buildBootstrapInstructions(hasAgentInstructions, 'Kimi Assistant')

      expect(prompt).toContain('Your name is already configured: "Kimi Assistant"')
      expect(prompt).not.toContain('What should your name be?')
      expect(prompt).not.toContain('action: "rename"')
      // Bootstrap itself still runs: persona/user discovery and completion stay.
      expect(prompt).toContain('complete_bootstrap')
      expect(prompt).toContain('SOUL.md')
    })

    it('trims the configured name', () => {
      const prompt = buildBootstrapInstructions(false, '  Kimi Assistant  ')

      expect(prompt).toContain('Your name is already configured: "Kimi Assistant"')
    })
  })

  describe('when the agent has no configured name', () => {
    it.each([undefined, null, '', '   '])('keeps the naming flow for name %j', (name) => {
      const prompt = buildBootstrapInstructions(false, name)

      expect(prompt).toContain('What should your name be?')
      expect(prompt).toContain('action: "rename"')
      expect(prompt).not.toContain('Your name is already configured')
    })

    it('keeps the naming flow for agents with a System Prompt but no name', () => {
      const prompt = buildBootstrapInstructions(true)

      expect(prompt).toContain('What should your name be?')
      expect(prompt).toContain('action: "rename"')
    })
  })
})
