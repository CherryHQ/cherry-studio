import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMock = vi.hoisted(() => ({
  setShowSidebar: vi.fn(),
  showSidebar: false
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [preferenceMock.showSidebar, preferenceMock.setShowSidebar]
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    active,
    children,
    onClick,
    tone,
    ...props
  }: {
    active?: boolean
    children: ReactNode
    onClick?: () => void
    tone?: string
  }) => (
    <button type="button" data-active={active || undefined} data-tone={tone} onClick={onClick} {...props}>
      {children}
    </button>
  )
}))

vi.mock('../Tools', () => ({
  default: () => <span>tools</span>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import AgentContent from '../AgentContent'

const agentA = {
  id: 'agent-a',
  name: 'Agent A',
  model: 'provider:model-a',
  type: 'claude_code'
} as any

describe('AgentContent', () => {
  beforeEach(() => {
    preferenceMock.showSidebar = false
    preferenceMock.setShowSidebar.mockClear()
  })

  it('keeps agent page tools in the navbar', () => {
    render(<AgentContent activeAgent={agentA} tools={<span>files</span>} />)

    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.queryByText('select agent b')).not.toBeInTheDocument()
    expect(screen.queryByText('select model b')).not.toBeInTheDocument()
  })

  it('does not render the workspace opener in the navbar', () => {
    render(<AgentContent activeAgent={agentA} tools={<span>files</span>} />)

    expect(screen.queryByRole('button', { name: 'open workspace' })).not.toBeInTheDocument()
  })

  it('hides agent-scoped navbar actions when no agent is active', () => {
    render(<AgentContent activeAgent={null} tools={<span>files</span>} />)

    expect(screen.queryByText('tools')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'open workspace' })).not.toBeInTheDocument()
  })

  it('keeps the sidebar toggle inactive when the sidebar is visible', () => {
    preferenceMock.showSidebar = true

    render(<AgentContent activeAgent={agentA} />)

    const [toggle] = screen.getAllByRole('button')

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('data-tone', 'conversation')
    expect(toggle).not.toHaveAttribute('data-active')
  })

  it('shows the inactive sidebar toggle and a new-session button when the sidebar is hidden', () => {
    render(<AgentContent activeAgent={agentA} />)

    const toggle = screen.getAllByRole('button')[0]

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('data-tone', 'conversation')
    expect(toggle).not.toHaveAttribute('data-active')
    expect(screen.getByRole('button', { name: 'agent.session.add.title' })).toBeInTheDocument()
  })

  it('hides the new-session button when the sidebar is visible', () => {
    preferenceMock.showSidebar = true

    render(<AgentContent activeAgent={agentA} />)

    expect(screen.queryByRole('button', { name: 'agent.session.add.title' })).not.toBeInTheDocument()
  })
})
