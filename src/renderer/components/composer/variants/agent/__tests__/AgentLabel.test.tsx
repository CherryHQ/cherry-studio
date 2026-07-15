import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgentLabel } from '../AgentLabel'

describe('AgentLabel', () => {
  it('falls back to the default agent avatar when stored avatar is blank', () => {
    render(<AgentLabel agent={{ name: 'Blank avatar agent', configuration: { avatar: '   ' } }} />)

    expect(screen.getByText('Blank avatar agent')).toBeInTheDocument()
    expect(screen.getAllByText('🤖').length).toBeGreaterThan(0)
  })

  it('uses the requested avatar size', () => {
    const { container } = render(
      <AgentLabel avatarSize={20} agent={{ name: 'Compact agent', configuration: { avatar: '🤖' } }} />
    )

    expect(container.querySelector<HTMLElement>('[style*="width: 20px"]')).toHaveStyle({
      width: '20px',
      height: '20px'
    })
  })
})
