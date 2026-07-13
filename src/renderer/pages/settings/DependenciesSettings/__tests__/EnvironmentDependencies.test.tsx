import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const installSettingsRef = vi.hoisted(() => ({
  value: { githubMirror: '', githubToken: '', npmRegistry: '', pipIndexUrl: '', verifySignatures: true }
}))
const setInstallSettingsMock = vi.hoisted(() => vi.fn())

const ipcMocks = vi.hoisted(() => ({
  resolveTools: vi.fn(),
  latestVersions: vi.fn(),
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getToolDir: vi.fn(),
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
  useMultiplePreferences: () => [installSettingsRef.value, setInstallSettingsMock]
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
    ConfirmDialog: ({
      open,
      title,
      description
    }: {
      open: boolean
      title: React.ReactNode
      description: React.ReactNode
    }) => (open ? React.createElement('div', { role: 'alertdialog' }, title, description) : null),
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
    MockUseCacheUtils.resetMocks()
    ipcEventHandlers.clear()
    installSettingsRef.value = {
      githubMirror: '',
      githubToken: '',
      npmRegistry: '',
      pipIndexUrl: '',
      verifySignatures: true
    }
    ipcMocks.latestVersions.mockResolvedValue({})
    ipcMocks.installTool.mockResolvedValue(undefined)
    ipcMocks.removeTool.mockResolvedValue(undefined)
    ipcMocks.listTools.mockResolvedValue([])
    ipcMocks.searchRegistry.mockResolvedValue([])
    ipcMocks.resolveTools.mockImplementation(async (names: string[]) => {
      const inventory = await ipcMocks.listTools()
      return Object.fromEntries(
        names.map((name) => {
          const tool = inventory.find((entry: { name: string }) => entry.name === name)
          return [
            name,
            tool ? { source: 'managed', path: `/managed/${name}`, version: tool.version } : { source: 'none' }
          ]
        })
      )
    })
    setInstallSettingsMock.mockResolvedValue(undefined)
  })

  it('writes advanced install settings to independent preferences', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

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
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    // First default item belongs to the GitHub mirror field (fields render in order).
    fireEvent.click(screen.getAllByText('settings.dependencies.installSettings.presetLabels.default')[0])
    fireEvent.click(screen.getByText('common.save'))

    expect(setInstallSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ githubMirror: '' }))
  })

  it('does not persist invalid install URLs', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubMirror.placeholder'), {
      target: { value: 'javascript:alert(1)' }
    })

    expect(screen.getByText('common.save').closest('button')).toBeDisabled()
    expect(setInstallSettingsMock).not.toHaveBeenCalled()
  })

  it('masks the token again when the settings dialog is reopened', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

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

    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())
    // Preset displayNames render regardless of install state.
    expect(screen.getByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
  })

  it('marks a system-PATH preset as available and shows its resolved path on the source badge', async () => {
    ipcMocks.resolveTools.mockResolvedValue({ fd: { source: 'system', path: '/usr/local/bin/fd' } })
    render(<EnvironmentDependencies />)

    const fdCard = (await screen.findByText('fd')).closest('[role="listitem"]') as HTMLElement
    expect(fdCard).toHaveTextContent('settings.dependencies.source.system')
    expect(fdCard.querySelector('[title="/usr/local/bin/fd"]')).toBeInTheDocument()
    expect(fdCard).not.toHaveTextContent('settings.mcp.install')
  })

  it('renders a manifest-owned custom tool alongside the presets', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'mytool', tool: 'npm:mytool', version: '', managed: true }])
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
    expect(screen.getByText('Bun')).toBeInTheDocument()
  })

  it('shows manifest inventory tools that are neither presets nor custom tools', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'some-agent', tool: 'npm:some-agent', version: '1.2.3' }])
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('some-agent')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('v1.2.3')
  })

  it('shows a runtime dependency as display-only (badge, no remove/update)', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'core:node', version: '22.23.1', managed: false }])
    ipcMocks.resolveTools.mockResolvedValue({
      node: { source: 'managed', path: '/managed/node', version: '22.23.1' }
    })
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('node')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.runtimeDependency')
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
    expect(within(card).queryByTitle('settings.dependencies.update')).not.toBeInTheDocument()
  })

  it('treats an unrecorded runtime dependency as installed, never offering install', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'node', version: '22.23.1', managed: false }])
    ipcMocks.resolveTools.mockResolvedValue({
      node: { source: 'managed', path: '/managed/node', version: '22.23.1' }
    })
    render(<EnvironmentDependencies />)

    // Name and tool spec are both the bare string 'node' — grab the card once.
    const card = (await screen.findAllByText('node'))[0].closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('v22.23.1')
    expect(card).toHaveTextContent('settings.dependencies.runtimeDependency')
    expect(card).not.toHaveTextContent('settings.mcp.install')
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('keeps an unavailable auto-discovered runtime read-only without offering install', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'node', version: '22.23.1', managed: false }])
    ipcMocks.resolveTools.mockResolvedValue({ node: { source: 'none' } })
    render(<EnvironmentDependencies />)

    const card = (await screen.findAllByText('node'))[0].closest('[role="listitem"]') as HTMLElement
    expect(card).not.toHaveTextContent('settings.mcp.install')
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('does not infer runtime ownership from live resolution alone', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'node', version: '22.23.1', managed: false }])
    ipcMocks.resolveTools.mockResolvedValue({
      node: { source: 'managed', path: '/managed/node', version: '22.23.1' }
    })
    render(<EnvironmentDependencies />)

    const card = (await screen.findAllByText('node'))[0].closest('[role="listitem"]') as HTMLElement
    expect(within(card).queryByTitle('settings.dependencies.update')).not.toBeInTheDocument()
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('keeps a managed runtime from the custom inventory actionable and warns before removal', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'core:node', version: '22.23.1', managed: true }])
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('node')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.runtimeDependency')
    expect(within(card).getByTitle('settings.dependencies.update')).toBeInTheDocument()

    fireEvent.click(within(card).getByLabelText('settings.dependencies.remove'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('settings.dependencies.removeRuntimeConfirmMessage')
  })

  it('allows taking explicit ownership of an auto-discovered runtime', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'node', version: '22.23.1', managed: false }])
    ipcMocks.searchRegistry.mockResolvedValue([{ name: 'node', tool: 'core:node' }])
    render(<EnvironmentDependencies />)

    fireEvent.click(screen.getByText('settings.dependencies.addTool'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.searchRegistry'), {
      target: { value: 'node' }
    })
    fireEvent.click(await screen.findByRole('button', { name: /core:node/ }))
    fireEvent.click(screen.getByText('common.add'))

    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({
        intent: { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }
      })
    )
  })

  it('shows a retry instead of a false installed state when an owned tool is unavailable', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'mytool', tool: 'npm:mytool', version: '1.2.3', managed: true }])
    ipcMocks.resolveTools.mockResolvedValue({ mytool: { source: 'none' } })
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.mcp.install')
    expect(within(card).queryByLabelText('settings.dependencies.openBinariesDir')).not.toBeInTheDocument()
    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
  })

  it('rejects adding a tool that already exists in the inventory', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'node', tool: 'core:node', version: '22.23.1', managed: true }])
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

  it('rejects adding a Code CLI reserved binary name even when it is hidden from the inventory', async () => {
    ipcMocks.searchRegistry.mockResolvedValue([{ name: 'claude', tool: 'npm:other-claude' }])
    render(<EnvironmentDependencies />)

    fireEvent.click(screen.getByText('settings.dependencies.addTool'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.searchRegistry'), {
      target: { value: 'claude' }
    })
    fireEvent.click(await screen.findByRole('button', { name: /npm:other-claude/ }))
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

  it('marks a manifest-owned system tool as available without offering installation', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'mytool', tool: 'npm:mytool', version: '', managed: true }])
    ipcMocks.resolveTools.mockResolvedValue({ mytool: { source: 'system', path: '/usr/local/bin/mytool' } })
    render(<EnvironmentDependencies />)

    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.source.system')
    expect(card).not.toHaveTextContent('settings.mcp.install')
  })

  it('shows an uninstall action for a mise-managed preset tool', async () => {
    // uv is mise-managed (source 'managed') → preset card exposes the uninstall button.
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: '1.0.0', managed: true }])
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByLabelText('settings.dependencies.remove').length).toBeGreaterThan(0))
  })

  it('keeps pinned recovery and removal available for an owned preset whose binary is missing', async () => {
    ipcMocks.listTools.mockResolvedValue([
      { name: 'uv', tool: 'uv', version: '', requestedVersion: '0.9.0', managed: true }
    ])
    ipcMocks.resolveTools.mockResolvedValue({ uv: { source: 'none' } })
    render(<EnvironmentDependencies />)

    const uvCard = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    expect(uvCard).toHaveTextContent('settings.mcp.install')
    expect(within(uvCard).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
    expect(within(uvCard).queryByLabelText('settings.dependencies.openBinariesDir')).not.toBeInTheDocument()

    fireEvent.click(within(uvCard).getByText('settings.mcp.install'))
    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({
        intent: { name: 'uv', tool: 'uv', requestedVersion: '0.9.0' }
      })
    )
  })

  it('hides the uninstall action for a bundled-only preset tool', async () => {
    // uv present only as bundled (source 'bundled') → not uninstallable, no remove button.
    ipcMocks.resolveTools.mockResolvedValue({ uv: { source: 'bundled', path: '/bundled/uv', version: '1.0.0' } })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())
    const uvCard = screen.getByText('uv').closest('[role="listitem"]') as HTMLElement
    expect(uvCard).not.toHaveTextContent('settings.dependencies.install')
    expect(screen.queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('renders nothing in mini mode once core deps are available', async () => {
    ipcMocks.resolveTools.mockResolvedValue({
      uv: { source: 'bundled', path: '/bundled/uv', version: '1.0.0' },
      bun: { source: 'bundled', path: '/bundled/bun', version: '1.0.0' }
    })
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(ipcMocks.resolveTools).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing in mini mode when core dependencies are system-installed', async () => {
    ipcMocks.resolveTools.mockResolvedValue({
      uv: { source: 'system', path: '/usr/local/bin/uv' },
      bun: { source: 'system', path: '/usr/local/bin/bun' }
    })
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.resolveTools).toHaveBeenCalled())
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
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())
    expect(ipcMocks.latestVersions).not.toHaveBeenCalled()
  })

  it('shows update available badge when latest version is newer', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: '1.0.0', managed: true }])
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    // The update badge shows the latest version (v2.0.0)
    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())
  })

  it('does not show update badge when versions are equal', async () => {
    // Override the semver mock: gt returns false (versions equal or older)
    const { gt } = await import('semver')
    vi.mocked(gt).mockReturnValue(false)
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: '1.0.0', managed: true }])
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
    ipcMocks.latestVersions.mockResolvedValue({ uv: 'nightly' })

    expect(() => render(<EnvironmentDependencies />)).not.toThrow()
    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalled())
    expect(screen.queryByText('vnightly')).not.toBeInTheDocument()
  })

  it('clears latest versions when binary state changes', async () => {
    const { gt } = await import('semver')
    vi.mocked(gt).mockReturnValue(true)
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: '1.0.0', managed: true }])
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())

    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(screen.queryByText('v2.0.0')).not.toBeInTheDocument())
  })

  it('updates a managed tool with the latest version as a one-shot target', async () => {
    const { gt } = await import('semver')
    vi.mocked(gt).mockImplementation((latest) => latest === '2.0.0')
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: '1.0.0', managed: true }])
    ipcMocks.latestVersions.mockResolvedValue({ uv: '1.0.0' })

    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    const updateButtons = await screen.findAllByTitle('settings.dependencies.update')
    fireEvent.click(updateButtons[0])

    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({ intent: { name: 'uv', tool: 'uv' }, targetVersion: '1.0.0' })
    )
    expect(ipcMocks.latestVersions).not.toHaveBeenCalledWith(true)
  })

  it('renders a persistent failure row from the shared install-state map and opens details on demand', async () => {
    const { rerender } = render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

    // The mock useSharedCache is not reactive — update the store, then rerender
    // to pick it up (production reactivity is covered by useCache's own tests).
    MockUseCacheUtils.setSharedCacheValue('feature.binary.install_states', {
      uv: { status: 'failed', error: 'mise failed\nnetwork timeout' }
    })
    rerender(<EnvironmentDependencies />)

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

  it('shows installing state and the duration hint from the shared install-state map', async () => {
    const { rerender } = render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())

    MockUseCacheUtils.setSharedCacheValue('feature.binary.install_states', { uv: { status: 'installing' } })
    rerender(<EnvironmentDependencies />)

    expect(await screen.findByText('settings.dependencies.installing')).toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.installingHint')).toBeInTheDocument()
  })

  it('shows an install already in flight when the window mounts mid-install', async () => {
    MockUseCacheUtils.setSharedCacheValue('feature.binary.install_states', { uv: { status: 'installing' } })

    render(<EnvironmentDependencies />)

    expect(await screen.findByText('settings.dependencies.installing')).toBeInTheDocument()
  })

  it('continues installing latest when update versions are not comparable semver', async () => {
    ipcMocks.listTools.mockResolvedValue([{ name: 'uv', tool: 'uv', version: 'nightly', managed: true }])
    ipcMocks.latestVersions.mockResolvedValue({ uv: 'nightly' })

    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    const updateButtons = await screen.findAllByTitle('settings.dependencies.update')
    fireEvent.click(updateButtons[0])

    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({
        intent: { name: 'uv', tool: 'uv' },
        targetVersion: 'nightly'
      })
    )
    expect(ipcMocks.latestVersions).not.toHaveBeenCalledWith(true)
  })

  it('waits for dependency checks before showing the mini warning', async () => {
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
  })

  it('keeps the mini warning hidden when dependency checks fail', async () => {
    ipcMocks.listTools.mockRejectedValue(new Error('not ready'))
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.listTools).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
