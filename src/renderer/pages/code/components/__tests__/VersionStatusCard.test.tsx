import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VersionStatusCard } from '../VersionStatusCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CliIcon', () => ({
  CliIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
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

  it('treats a system PATH tool as launchable without install or remove actions', () => {
    render(
      <VersionStatusCard
        toolId="claude-code"
        toolName="Claude Code"
        status={{
          installed: true,
          source: 'system',
          systemPath: '/usr/local/bin/claude',
          canUpgrade: false
        }}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    expect(screen.getByText('settings.dependencies.source.system')).toHaveAttribute('title', '/usr/local/bin/claude')
    expect(screen.queryByRole('button', { name: 'code.install' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.dependencies.remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeEnabled()
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

  it('renders the latest-version hint and upgrade action when upgrade is available', () => {
    const onUpgrade = vi.fn()
    render(
      <VersionStatusCard
        toolId="qwen-code"
        toolName="Qwen Code"
        status={{ installed: true, current: '1.0.0', latest: '1.1.0', canUpgrade: true }}
        onUpgrade={onUpgrade}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    expect(screen.getByText('v1.1.0')).toHaveClass('text-warning')
    fireEvent.click(screen.getByRole('button', { name: 'code.upgrade' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('renders the upgrade installing state while upgrading', () => {
    render(
      <VersionStatusCard
        toolId="qwen-code"
        toolName="Qwen Code"
        status={{ installed: true, current: '1.0.0', latest: '1.1.0', canUpgrade: true }}
        onUpgrade={vi.fn()}
        isUpgrading
      />
    )

    expect(screen.getByRole('button', { name: 'code.installing' })).toBeDisabled()
  })

  it('renders an open-dashboard action when running and triggers it on click', () => {
    const onOpenDashboard = vi.fn()
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ installed: true, canUpgrade: false }}
        onStop={vi.fn()}
        running
        onOpenDashboard={onOpenDashboard}
      />
    )

    const button = screen.getByRole('button', { name: 'openclaw.gateway.open_dashboard' })
    fireEvent.click(button)
    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
  })

  it('omits the open-dashboard action when not running', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ installed: true, canUpgrade: false }}
        onLaunch={vi.fn()}
        canLaunch
        onOpenDashboard={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'openclaw.gateway.open_dashboard' })).not.toBeInTheDocument()
  })

  it('omits the open-dashboard action when no handler is provided', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ installed: true, canUpgrade: false }}
        onStop={vi.fn()}
        running
      />
    )

    expect(screen.queryByRole('button', { name: 'openclaw.gateway.open_dashboard' })).not.toBeInTheDocument()
  })
})
