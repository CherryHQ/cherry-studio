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
        status={{ source: 'none', installed: false, canUpgrade: false }}
        onInstall={vi.fn()}
      />
    )

    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText('code.not_installed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.install' })).toBeInTheDocument()
  })

  it('keeps a system PATH tool read-only, exposing only launch', () => {
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
    // Cherry uses the system binary in place — never an uninstall, never a shadow copy.
    expect(screen.queryByRole('button', { name: 'code.install' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.dependencies.uninstall' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeEnabled()
  })

  it('keeps a bundled tool read-only with no install or uninstall action', () => {
    render(
      <VersionStatusCard
        toolId="claude-code"
        toolName="Claude Code"
        status={{ installed: true, source: 'bundled', current: '1.0.0', canUpgrade: false }}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    expect(screen.queryByRole('button', { name: 'code.install' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.dependencies.uninstall' })).not.toBeInTheDocument()
  })

  it('renders a disabled launch action when launch requirements are missing', () => {
    render(
      <VersionStatusCard
        toolId="qwen-code"
        toolName="Qwen Code"
        status={{ source: 'none', installed: true, canUpgrade: false }}
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
        status={{ source: 'none', installed: true, canUpgrade: false }}
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
        status={{ source: 'none', installed: true, current: '1.0.0', latest: '1.1.0', canUpgrade: true }}
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
        status={{ source: 'none', installed: true, current: '1.0.0', latest: '1.1.0', canUpgrade: true }}
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
        status={{ source: 'none', installed: true, canUpgrade: false }}
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
        status={{ source: 'none', installed: true, canUpgrade: false }}
        onLaunch={vi.fn()}
        canLaunch
        onOpenDashboard={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'openclaw.gateway.open_dashboard' })).not.toBeInTheDocument()
  })

  it('renders a persistent failure row with retry label and opens details on click', () => {
    const onShowError = vi.fn()
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ source: 'none', installed: false, canUpgrade: false }}
        onInstall={vi.fn()}
        installError={'mise use timed out after 900s\nmise npm:openclaw   [1/3] install'}
        onShowError={onShowError}
      />
    )

    // Install button flips to retry; row shows only the error's first line.
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument()
    const row = screen.getByText('mise use timed out after 900s')
    expect(screen.queryByText(/\[1\/3\] install/)).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(onShowError).toHaveBeenCalledTimes(1)
  })

  it('offers retry when install succeeded physically but a follow-up failed', () => {
    const onInstall = vi.fn()
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{
          installed: true,
          source: 'mise',
          canUpgrade: false,
          operation: { status: 'failed', action: 'install', error: 'preference write failed' }
        }}
        onInstall={onInstall}
        onLaunch={vi.fn()}
        canLaunch
        installError="preference write failed"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'settings.dependencies.uninstall' })).not.toBeInTheDocument()
  })

  it('offers repair for a broken fixed copy even when an external CLI remains runnable', () => {
    const onInstall = vi.fn()
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{
          installed: true,
          source: 'system',
          applicationStatus: 'broken',
          canUpgrade: false
        }}
        onInstall={onInstall}
        onRemove={vi.fn()}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'settings.dependencies.uninstall' })).toBeInTheDocument()
  })

  it('offers a probe retry for an unknown application without exposing uninstall', () => {
    const onInstall = vi.fn()
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{
          installed: true,
          source: 'system',
          applicationStatus: 'unknown',
          canUpgrade: false
        }}
        onInstall={onInstall}
        onRemove={vi.fn()}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'settings.dependencies.uninstall' })).not.toBeInTheDocument()
  })

  it('keeps uninstall available for a broken unavailable tool and never offers install retry after uninstall fails', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{
          installed: false,
          source: 'none',
          applicationStatus: 'broken',
          canUpgrade: false,
          operation: { status: 'failed', action: 'remove', error: 'mise uninstall failed' }
        }}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'settings.dependencies.uninstall' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'common.retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code.install' })).not.toBeInTheDocument()
  })

  it('disables conflicting actions and renders only an uninstall spinner while removing', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{
          installed: true,
          source: 'mise',
          applicationStatus: 'applied',
          canUpgrade: true,
          operation: { status: 'removing' }
        }}
        onUpgrade={vi.fn()}
        onRemove={vi.fn()}
        onLaunch={vi.fn()}
        canLaunch
      />
    )

    expect(screen.getByRole('button', { name: 'settings.dependencies.uninstall' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'code.upgrade' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'code.launch.label' })).toBeDisabled()
    expect(screen.queryByText('code.installing')).not.toBeInTheDocument()
  })

  it('hides the failure row and shows the duration hint while installing', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ source: 'none', installed: false, canUpgrade: false }}
        onInstall={vi.fn()}
        isInstalling
        installError="previous failure"
        onShowError={vi.fn()}
      />
    )

    expect(screen.queryByText('previous failure')).not.toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.installingHint')).toBeInTheDocument()
  })

  it('omits the open-dashboard action when no handler is provided', () => {
    render(
      <VersionStatusCard
        toolId="openclaw"
        toolName="OpenClaw"
        status={{ source: 'none', installed: true, canUpgrade: false }}
        onStop={vi.fn()}
        running
      />
    )

    expect(screen.queryByRole('button', { name: 'openclaw.gateway.open_dashboard' })).not.toBeInTheDocument()
  })
})
