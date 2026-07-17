import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentLabel } from '../AgentLabel'

describe('AgentLabel', () => {
  it('renders the selected agent avatar', () => {
    render(<AgentLabel agent={{ name: 'Agent', avatar: { kind: 'emoji', emoji: '🧠' } }} />)

    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getAllByText('🧠').length).toBeGreaterThan(0)
  })

  it('uses the requested avatar size', () => {
    const { container } = render(
      <AgentLabel avatarSize={20} agent={{ name: 'Compact agent', avatar: { kind: 'emoji', emoji: '🤖' } }} />
    )

    expect(container.querySelector<HTMLElement>('[style*="width: 20px"]')).toHaveStyle({
      width: '20px',
      height: '20px'
    })
  })
})
