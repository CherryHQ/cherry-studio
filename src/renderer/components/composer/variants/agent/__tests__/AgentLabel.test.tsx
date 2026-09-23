import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { AgentLabel } from '../AgentLabel'

vi.unmock('@cherrystudio/ui')

describe('AgentLabel', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('falls back to the default agent avatar when stored avatar is blank', () => {
    render(<AgentLabel agent={{ name: 'Blank avatar agent', configuration: { avatar: '   ' } }} />)

    expect(screen.getByText('Blank avatar agent')).toBeInTheDocument()
    expect(screen.getAllByText('🤖').length).toBeGreaterThan(0)
  })

  it('exposes the active runtime mode without replacing the custom avatar', () => {
    render(<AgentLabel agent={{ name: 'Pi agent', type: 'pi', configuration: { avatar: '🧪' } }} />)

    expect(screen.getAllByText('🧪').length).toBeGreaterThan(0)
    const badge = screen.getByRole('img')
    expect(badge.getAttribute('data-agent-runtime-mode')).toBe('pi')
    expect(badge.getAttribute('aria-label')).toContain('Pi')
  })

  it.each(['future-runtime', 'constructor', 'toString', '__proto__'])(
    'uses an accessible fallback for runtime %s',
    (type) => {
      render(<AgentLabel agent={{ name: 'Unknown agent', type }} />)

      const badge = screen.getByRole('img')
      expect(badge.getAttribute('data-agent-runtime-mode')).toBe('unknown')
      expect(badge).toHaveAccessibleName('Agent runtime mode: Unknown')
    }
  )
})
