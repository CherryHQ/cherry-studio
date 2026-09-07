import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentLabel } from '../AgentLabel'

describe('AgentLabel', () => {
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

  it('uses an accessible fallback label for an unknown runtime mode', () => {
    render(<AgentLabel agent={{ name: 'Unknown agent', type: 'future-runtime' }} />)

    const badge = screen.getByRole('img')
    expect(badge.getAttribute('data-agent-runtime-mode')).toBe('unknown')
    expect(badge.getAttribute('aria-label')).toBeTruthy()
    expect(badge.getAttribute('aria-label')).toBe(badge.getAttribute('title'))
  })
})
