import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VersionStatusCard } from '../VersionStatusCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CLIIcon', () => ({
  CLIIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
}))

describe('VersionStatusCard', () => {
  it('keeps the install action but omits the not-installed title badge', () => {
    render(
      <VersionStatusCard
        toolId="claude-code"
        toolName="Claude Code"
        status={{ installed: false, canUpgrade: false }}
        onInstall={vi.fn()}
      />
    )

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText('code.not_installed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.install' })).toBeInTheDocument()
  })

  it('renders a disabled launch action when launch requirements are missing', () => {
    render(
      <VersionStatusCard
        toolId="qwen-code"
        toolName="Qwen Code"
        status={{ installed: true, canUpgrade: false }}
        onLaunch={vi.fn()}
        canLaunch={false}
      />
    )

    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
  })

  it('renders the launching state', () => {
    render(
      <VersionStatusCard
        toolId="qwen-code"
        toolName="Qwen Code"
        status={{ installed: true, canUpgrade: false }}
        onLaunch={vi.fn()}
        canLaunch
        launching
      />
    )

    expect(screen.getByRole('button', { name: 'code.launching' })).toBeDisabled()
  })
})
