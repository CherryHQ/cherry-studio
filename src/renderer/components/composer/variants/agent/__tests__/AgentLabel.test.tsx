import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentLabel } from '../AgentLabel'

describe('AgentLabel', () => {
  it('renders the agent avatar', () => {
    render(<AgentLabel agent={{ name: 'Agent', avatar: { kind: 'emoji', emoji: '🤖' } }} />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getAllByText('🤖').length).toBeGreaterThan(0)
  })
})
