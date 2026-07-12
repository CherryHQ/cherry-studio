import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const customToolsRef = vi.hoisted(() => ({ value: [] as Array<{ name: string; tool: string; version?: string }> }))
const setCustomToolsMock = vi.hoisted(() => vi.fn())
const installSettingsRef = vi.hoisted(() => ({
  value: { githubMirror: '', githubToken: '', npmRegistry: '', pipIndexUrl: '', verifySignatures: true }
}))
const setInstallSettingsMock = vi.hoisted(() => vi.fn())

const ipcMocks = vi.hoisted(() => ({
  resolveTools: vi.fn(),
  getState: vi.fn(),
  probeBundled: vi.fn(),
  probeSystem: vi.fn(),
  latestVersions: vi.fn(),
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getToolDir: vi.fn(),
  getInstallStates: vi.fn(),
  listTools: vi.fn(),
  searchRegistry: vi.fn()
}))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

// Route ipcApi.request by binary.* route to the per-method mocks above.
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input?: unknown) => {
      switch (route) {
        case 'binary.resolve_tools':
          return ipcMocks.resolveTools(input)
        case 'binary.install_tool':
          return ipcMocks.installTool(input)
        case 'binary.remove_tool':
          return ipcMocks.removeTool(input)
        case 'local_model.get_status':
          return Promise.resolve({ status: 'unsupported' })
        case 'binary.get_latest_versions':
          return ipcMocks.latestVersions(input)
        case 'binary.get_install_states':
          return ipcMocks.getInstallStates()
        case 'binary.list_tools':
          return ipcMocks.listTools()
        case 'binary.search_registry':
          return ipcMocks.searchRegistry(input)
        default:
          throw new Error(`unexpected route: ${route}`)
      }
    }
  },
  useIpcOn: vi.fn((event: string, handler: (payload: unknown) => void) => {
    ipcEventHandlers.set(event, handler)
  })
}))

vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({ toast: toastMock }))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [installSettingsRef.value, setInstallSettingsMock],
  usePreference: () => [customToolsRef.value, setCustomToolsMock]
}))

vi.mock('semver', () => ({
  gt: vi.fn(() => true),
  valid: vi.fn((version: string) => (/^\d+\.\d+\.\d+/.test(version) ? version : null))
}))

// The shared global @cherrystudio/ui mock omits ConfirmDialog / DialogDescription
// that this component renders, so stub exactly what it imports here.
vi.mock('@cherrystudio/ui', () => {
  const passthrough =
    (tag: string) =>
    ({ children, closeOnOverlayClick, ...props }: { children?: React.ReactNode; closeOnOverlayClick?: boolean }) => {
      void closeOnOverlayClick
      return React.createElement(tag, props, children)
    }
  // Render children only — these carry non-DOM props that React would warn
  // about if spread onto a div.
  const childrenOnly = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  const dialog = ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? React.createElement('div', { role: 'dialog' }, children) : null
  return {
    Badge: passthrough('span'),
    Button: ({
      children,
      onClick,
      'aria-label': ariaLabel,
      disabled,
      title
    }: {
      children?: React.ReactNode
      onClick?: () => void
      'aria-label'?: string
      disabled?: boolean
      title?: string
    }) => React.createElement('button', { onClick, 'aria-label': ariaLabel, disabled, title }, children),
    ConfirmDialog: childrenOnly,
    Dialog: dialog,
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('div'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('div'),
    DescriptionSwitch: ({
      checked,
      label,
      onCheckedChange
    }: {
      checked: boolean
      label: string
      onCheckedChange: (checked: boolean) => void
    }) => React.createElement('button', { onClick: () => onCheckedChange(!checked) }, label),
    Field: passthrough('div'),
    FieldDescription: passthrough('div'),
    FieldLabel: passthrough('label'),
    Input: passthrough('input'),
    InputGroup: passthrough('div'),
    InputGroupAddon: passthrough('div'),
    InputGroupButton: passthrough('button'),
    InputGroupInput: passthrough('input'),
    SelectDropdown: ({
      items,
      onSelect
    }: {
      items: Array<{ id: string; label: string }>
      onSelect: (id: string) => void
    }) =>
      React.createElement(
        'div',
        null,
        items.map((item) =>
          React.createElement('button', { key: item.id, onClick: () => onSelect(item.id) }, item.label)
        )
      )
  }
})

describe('EnvironmentDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    customToolsRef.value = []
    installSettingsRef.value = {
      githubMirror: '',
      githubToken: '',
      npmRegistry: '',
      pipIndexUrl: '',
      verifySignatures: true
    }
    ipcMocks.getState.mockResolvedValue({ tools: {} })
    ipcMocks.probeBundled.mockResolvedValue({})
    ipcMocks.probeSystem.mockResolvedValue({})
    ipcMocks.latestVersions.mockResolvedValue({})
    ipcMocks.installTool.mockResolvedValue(undefined)
    ipcMocks.removeTool.mockResolvedValue(undefined)
    ipcMocks.getInstallStates.mockResolvedValue({})
    ipcMocks.listTools.mockResolvedValue([])
    ipcMocks.searchRegistry.mockResolvedValue([])
    ipcMocks.resolveTools.mockImplementation(async (names: string[]) => {
      const [state, bundled, system] = await Promise.all([
        ipcMocks.getState(),
        ipcMocks.probeBundled(),
        ipcMocks.probeSystem(names)
      ])
      return Object.fromEntries(
        names.map((name) => {
          const managed = state.tools[name]
          if (managed) return [name, { source: 'managed', path: `/managed/${name}`, version: managed.version }]
          if (name in bundled) {
            const version = bundled[name] ?? undefined
            return [name, { source: 'bundled', path: `/bundled/${name}`, ...(version ? { version } : {}) }]
          }
          if (system[name]) return [name, { source: 'system', path: system[name] }]
          return [name, { source: 'none' }]
        })
      )
    })
    setInstallSettingsMock.mockResolvedValue(undefined)
  })

  it('writes advanced install settings to independent preferences', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubMirror.placeholder'), {
      target: { value: 'https://ghfast.top' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.npmRegistry.placeholder'), {
      target: { value: 'https://registry.example' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.pipIndexUrl.placeholder'), {
      target: { value: 'https://pypi.example/simple' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubToken.placeholder'), {
      target: { value: 'ghp_secret' }
    })
    fireEvent.click(screen.getByText('settings.dependencies.installSettings.verifySignatures.label'))
    expect(setInstallSettingsMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('common.save'))
    expect(setInstallSettingsMock).toHaveBeenCalledWith({
      githubMirror: 'https://ghfast.top',
      npmRegistry: 'https://registry.example',
      pipIndexUrl: 'https://pypi.example/simple',
      githubToken: 'ghp_secret',
      verifySignatures: false
    })
  })

  it('resets a mirror back to default (empty) via the default preset item', async () => {
    installSettingsRef.value = {
      githubMirror: 'https://ghfast.top',
      githubToken: '',
      npmRegistry: '',
      pipIndexUrl: '',
      verifySignatures: true
    }
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    // First default item belongs to the GitHub mirror field (fields render in order).
    fireEvent.click(screen.getAllByText('settings.dependencies.installSettings.presetLabels.default')[0])
    fireEvent.click(screen.getByText('common.save'))

    expect(setInstallSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ githubMirror: '' }))
  })

  it('does not persist invalid install URLs', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubMirror.placeholder'), {
      target: { value: 'javascript:alert(1)' }
    })

    expect(screen.getByText('common.save').closest('button')).toBeDisabled()
    expect(setInstallSettingsMock).not.toHaveBeenCalled()
  })

  it('masks the token again when the settings dialog is reopened', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    const token = screen.getByPlaceholderText('settings.dependencies.installSettings.githubToken.placeholder')
    fireEvent.click(screen.getByLabelText('settings.dependencies.installSettings.githubToken.show'))
    expect(token).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByText('common.cancel'))
    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    expect(
      screen.getByPlaceholderText('settings.dependencies.installSettings.githubToken.placeholder')
    ).toHaveAttribute('type', 'password')
  })

  it('renders all preset tools in the unified grid', async () => {
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    // Preset displayNames render regardless of install state.
    expect(screen.getByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
  })

  it('marks a system-PATH preset as available and shows its resolved path on the source badge', async () => {
    ipcMocks.probeSystem.mockResolvedValue({ fd: '/usr/local/bin/fd' })
    render(<EnvironmentDependencies />)

    const fdCard = (await screen.findByText('fd')).closest('[role="listitem"]') as HTMLElement
    expect(fdCard).toHaveTextContent('settings.dependencies.source.system')
    expect(fdCard.querySelector('[title="/usr/local/bin/fd"]')).toBeInTheDocument()
    expect(fdCard).not.toHaveTextContent('settings.mcp.install')
  })

  it('renders a persisted custom tool alongside the presets', async () => {
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
    expect(screen.getByText('Bun')).toBeInTheDocument()
  })

  it('shows state-file inventory tools that are neither presets nor custom tools', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'some-agent', tool: 'npm:some-agent', version: '1.2.3' }])
    ipcMocks.getState.mockResolvedValue({ tools: { 'some-agent': { version: '1.2.3' } } })
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('some-agent')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('v1.2.3')
  })

  it('rejects adding a tool that already exists in the inventory', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'core:node', version: '22.23.1' }])
    ipcMocks.searchRegistry.mockResolvedValue([{ name: 'node', tool: 'core:node' }])
    render(<EnvironmentDependencies />)
    await screen.findByText('node')

    fireEvent.click(screen.getByText('settings.dependencies.addTool'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.searchRegistry'), {
      target: { value: 'node' }
    })
    fireEvent.click(await screen.findByRole('button', { name: /core:node/ }))
    fireEvent.click(screen.getByText('common.add'))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('settings.dependencies.duplicateName'))
    expect(ipcMocks.installTool).not.toHaveBeenCalled()
  })

  it('excludes code CLI binaries from the inventory grid', async () => {
    ipcMocks.listTools.mockResolvedValue([
      { name: 'claude', tool: 'npm:@anthropic-ai/claude-code', version: '1.0.0' },
      { name: 'openclaw', tool: 'npm:openclaw', version: '1.0.0' },
      { name: 'some-agent', tool: 'npm:some-agent', version: '1.2.3' }
    ])
    render(<EnvironmentDependencies />)

    await screen.findByText('some-agent')
    expect(screen.queryByText('claude')).not.toBeInTheDocument()
    expect(screen.queryByText('openclaw')).not.toBeInTheDocument()
  })

  it('marks a custom system tool as available without offering installation', async () => {
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    ipcMocks.probeSystem.mockResolvedValue({ mytool: '/usr/local/bin/mytool' })
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.source.system')
    expect(card).not.toHaveTextContent('settings.mcp.install')
  })

  it('shows an uninstall action for a mise-managed preset tool', async () => {
    // uv is mise-managed (source 'managed') → preset card exposes the uninstall button.
    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByLabelText('settings.dependencies.remove').length).toBeGreaterThan(0))
  })

  it('hides the uninstall action for a bundled-only preset tool', async () => {
    // uv present only as bundled (source 'bundled') → not uninstallable, no remove button.
    ipcMocks.probeBundled.mockResolvedValue({ uv: '1.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    const uvCard = screen.getByText('uv').closest('[role="listitem"]') as HTMLElement
    expect(uvCard).not.toHaveTextContent('settings.dependencies.install')
    expect(screen.queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('renders nothing in mini mode once core deps are available', async () => {
    ipcMocks.probeBundled.mockResolvedValue({ uv: '1.0.0', bun: '1.0.0' })
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(ipcMocks.probeBundled).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing in mini mode when core dependencies are system-installed', async () => {
    ipcMocks.probeSystem.mockResolvedValue({ uv: '/usr/local/bin/uv', bun: '/usr/local/bin/bun' })
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.probeSystem).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('fetches latest versions on mount', async () => {
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
  })

  it('does not fetch latest versions in mini mode', async () => {
    render(<EnvironmentDependencies mini />)

    // Mini mode mounts without rendering update-version UI, so the fetch must be skipped.
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    expect(ipcMocks.latestVersions).not.toHaveBeenCalled()
  })

  it('shows update available badge when latest version is newer', async () => {
    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    // The update badge shows the latest version (v2.0.0)
    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())
  })

  it('does not show update badge when versions are equal', async () => {
    // Override the semver mock: gt returns false (versions equal or older)
    const { gt } = await import('semver')
    vi.mocked(gt).mockReturnValue(false)

    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '1.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalled())
    // Only the installed-version badge renders; no second update badge for the same version.
    await waitFor(() => expect(screen.getAllByText('v1.0.0')).toHaveLength(1))
  })

  it('does not throw or show update badge for a non-semver latest version', async () => {
    const { gt } = await import('semver')
    vi.mocked(gt).mockImplementation(() => {
      throw new TypeError('Invalid Version')
    })

    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: 'nightly' })

    expect(() => render(<EnvironmentDependencies />)).not.toThrow()
    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalled())
    expect(screen.queryByText('vnightly')).not.toBeInTheDocument()
  })

  it('clears latest versions when binary state changes', async () => {
    const { gt } = await import('semver')
    vi.mocked(gt).mockReturnValue(true)

    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())

    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(screen.queryByText('v2.0.0')).not.toBeInTheDocument())
  })

  it('updates a managed tool without forcing a full latest-version refresh', async () => {
    const { gt } = await import('semver')
    vi.mocked(gt).mockImplementation((latest) => latest === '2.0.0')

    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '1.0.0' })

    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    const updateButtons = await screen.findAllByTitle('settings.dependencies.update')
    fireEvent.click(updateButtons[0])

    await waitFor(() => expect(ipcMocks.installTool).toHaveBeenCalledWith({ name: 'uv', tool: 'uv' }))
    expect(ipcMocks.latestVersions).not.toHaveBeenCalledWith(true)
  })

  it('renders a persistent failure row from the install-state broadcast and opens details on demand', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    act(() => {
      ipcEventHandlers.get('binary.install_states_changed')?.({
        uv: { status: 'failed', error: 'mise failed\nnetwork timeout' }
      })
    })

    // First-level notification: failure row on the card, no auto-popped dialog.
    const failureRow = await screen.findByText('settings.dependencies.viewErrorDetails')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Retry label replaces the plain install label on the failed card.
    expect(screen.getByText('common.retry')).toBeInTheDocument()

    fireEvent.click(failureRow)
    expect(await screen.findByRole('dialog')).toHaveTextContent('mise failed')
    expect(screen.getByRole('dialog')).toHaveTextContent('network timeout')
    expect(screen.getByRole('dialog')).toHaveTextContent('settings.dependencies.installErrorHint')
  })

  it('shows installing state and the duration hint from the install-state broadcast', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

    act(() => {
      ipcEventHandlers.get('binary.install_states_changed')?.({ uv: { status: 'installing' } })
    })

    expect(await screen.findByText('settings.dependencies.installing')).toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.installingHint')).toBeInTheDocument()
  })

  it('hydrates install states for a window mounted mid-install', async () => {
    ipcMocks.getInstallStates.mockResolvedValue({ uv: { status: 'installing' } })

    render(<EnvironmentDependencies />)

    expect(await screen.findByText('settings.dependencies.installing')).toBeInTheDocument()
  })

  it('continues installing latest when update versions are not comparable semver', async () => {
    ipcMocks.getState.mockResolvedValue({ tools: { uv: { version: 'nightly' } } })
    ipcMocks.latestVersions.mockResolvedValue({ uv: 'nightly' })

    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    const updateButtons = await screen.findAllByTitle('settings.dependencies.update')
    fireEvent.click(updateButtons[0])

    await waitFor(() => expect(ipcMocks.installTool).toHaveBeenCalledWith({ name: 'uv', tool: 'uv' }))
    expect(ipcMocks.latestVersions).not.toHaveBeenCalledWith(true)
  })

  it('waits for dependency checks before showing the mini warning', async () => {
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
  })

  it('keeps the mini warning hidden when dependency checks fail', async () => {
    ipcMocks.getState.mockRejectedValue(new Error('not ready'))
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
