import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

import { CodeCliContentPanel } from '../CodeCliContentPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('CodeCliContentPanel OpenClaw startup error', () => {
  it('keeps failure details visible with copy and dismiss actions', async () => {
    const user = userEvent.setup()
    const onCopyStartupError = vi.fn()
    const onDismissStartupError = vi.fn()

    render(
      <CodeCliContentPanel
        selectedCliTool={CodeCli.OPENCLAW}
        activeMeta={{ id: CodeCli.OPENCLAW, label: 'OpenClaw', icon: null }}
        versionStatus={{ installed: false, source: 'none', canUpgrade: false }}
        startupError={{ operation: 'openclaw.start_gateway', message: 'Gateway startup timed out' }}
        versionCard={{
          visible: false,
          canLaunch: false,
          launching: false,
          running: false,
          stopping: false,
          upgradeDisabled: false
        }}
        installingTools={new Set()}
        upgradingTools={new Set()}
        providerState={{ providerless: true, showSelectionHint: false }}
        supportedProviders={[]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveProviderMeta={() => ({ providerName: '' })}
        onInstall={vi.fn()}
        onUpgrade={vi.fn()}
        onLaunch={vi.fn()}
        onStop={vi.fn()}
        onOpenDashboard={vi.fn()}
        onCopyStartupError={onCopyStartupError}
        onDismissStartupError={onDismissStartupError}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Gateway startup timed out')

    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    await user.click(screen.getByRole('button', { name: 'common.close' }))

    expect(onCopyStartupError).toHaveBeenCalledOnce()
    expect(onDismissStartupError).toHaveBeenCalledOnce()
  })
})
