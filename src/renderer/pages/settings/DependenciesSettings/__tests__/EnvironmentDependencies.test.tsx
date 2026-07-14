import type { BinaryToolSnapshot } from '@shared/types/binary'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { gt as semverGt } from 'semver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const installSettingsRef = vi.hoisted(() => ({
  value: { githubMirror: '', githubToken: '', npmRegistry: '', pipIndexUrl: '', verifySignatures: true }
}))
const setInstallSettingsMock = vi.hoisted(() => vi.fn())
const snapshotRecords = vi.hoisted(() => ({ value: {} as Record<string, BinaryToolSnapshot> }))
const ipcMocks = vi.hoisted(() => ({
  snapshots: vi.fn(),
  latestVersions: vi.fn(),
  installTool: vi.fn(),
  removeTool: vi.fn(),
  searchRegistry: vi.fn()
}))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

const setSnapshots = (records: Record<string, BinaryToolSnapshot>) => {
  snapshotRecords.value = records
}

const miseSnapshot = (
  name: string,
  tool = name,
  version = '1.0.0',
  owned = true,
  operation?: BinaryToolSnapshot['operation']
): BinaryToolSnapshot => ({
  name,
  ...(owned ? { intent: { name, tool } } : {}),
  availability: { source: 'mise', tool, path: `/mise/${name}`, version },
  ...(operation ? { operation } : {})
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input?: unknown) => {
      switch (route) {
        case 'binary.get_tool_snapshots':
          return ipcMocks.snapshots(input)
        case 'binary.install_tool':
          return ipcMocks.installTool(input)
        case 'binary.remove_tool':
          return ipcMocks.removeTool(input)
        case 'local_model.get_status':
          return Promise.resolve({ status: 'unsupported' })
        case 'binary.get_latest_versions':
          return ipcMocks.latestVersions(input)
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

vi.mock('@renderer/ipc/useIpcOn', () => ({ useIpcOn: vi.fn() }))
vi.mock('@renderer/services/toast', () => ({ toast: toastMock }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [installSettingsRef.value, setInstallSettingsMock]
}))
vi.mock('semver', () => ({
  gt: vi.fn(() => true),
  valid: vi.fn((version: string) => (/^\d+\.\d+\.\d+/.test(version) ? version : null))
}))
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
    Button: ({ children, onClick, 'aria-label': ariaLabel, disabled, title }: any) =>
      React.createElement('button', { onClick, 'aria-label': ariaLabel, disabled, title }, children),
    ConfirmDialog: ({ open, title, description, confirmText, onConfirm }: any) =>
      open
        ? React.createElement(
            'div',
            { role: 'alertdialog' },
            title,
            description,
            React.createElement(
              'button',
              { onClick: () => onConfirm?.(), 'data-testid': 'confirm-dialog-confirm' },
              confirmText ?? 'confirm'
            )
          )
        : null,
    Dialog: dialog,
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('div'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('div'),
    DescriptionSwitch: ({ checked, label, onCheckedChange }: any) =>
      React.createElement('button', { onClick: () => onCheckedChange(!checked) }, label),
    Field: passthrough('div'),
    FieldDescription: passthrough('div'),
    FieldLabel: passthrough('label'),
    Input: passthrough('input'),
    InputGroup: passthrough('div'),
    InputGroupAddon: passthrough('div'),
    InputGroupButton: passthrough('button'),
    InputGroupInput: passthrough('input'),
    SelectDropdown: ({ items, onSelect }: any) =>
      React.createElement(
        'div',
        null,
        items.map((item: any) =>
          React.createElement('button', { key: item.id, onClick: () => onSelect(item.id) }, item.label)
        )
      )
  }
})

describe('EnvironmentDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    vi.mocked(semverGt).mockImplementation(() => true)
    setSnapshots({})
    installSettingsRef.value = {
      githubMirror: '',
      githubToken: '',
      npmRegistry: '',
      pipIndexUrl: '',
      verifySignatures: true
    }
    ipcMocks.snapshots.mockImplementation(async () => snapshotRecords.value)
    ipcMocks.latestVersions.mockResolvedValue({})
    ipcMocks.installTool.mockResolvedValue(undefined)
    ipcMocks.removeTool.mockResolvedValue(undefined)
    ipcMocks.searchRegistry.mockResolvedValue([])
    setInstallSettingsMock.mockResolvedValue(undefined)
  })

  it('writes advanced install settings to independent preferences', async () => {
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.installSettings.title'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubMirror.placeholder'), {
      target: { value: 'https://ghfast.top' }
    })
    fireEvent.click(screen.getByText('settings.dependencies.installSettings.verifySignatures.label'))
    fireEvent.click(screen.getByText('common.save'))
    expect(setInstallSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ githubMirror: 'https://ghfast.top', verifySignatures: false })
    )
  })

  it('keeps install settings open and blocks duplicate saves when persistence fails', async () => {
    let rejectSave!: (error: Error) => void
    setInstallSettingsMock.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectSave = reject
      })
    )
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.installSettings.title'))
    const saveButton = screen.getByText('common.save').closest('button')!

    fireEvent.click(saveButton)
    await waitFor(() => expect(saveButton).toBeDisabled())
    fireEvent.click(saveButton)
    expect(setInstallSettingsMock).toHaveBeenCalledTimes(1)

    rejectSave(new Error('preference write failed'))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('preference write failed'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(saveButton).not.toBeDisabled()
  })

  it('does not persist invalid install URLs', async () => {
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.installSettings.title'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.installSettings.githubMirror.placeholder'), {
      target: { value: 'javascript:alert(1)' }
    })
    expect(screen.getByText('common.save').closest('button')).toBeDisabled()
  })

  it('renders all preset tools from snapshots', async () => {
    render(<EnvironmentDependencies />)
    expect(await screen.findByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
  })

  it('gives the public icon-only dependency actions accessible names', async () => {
    render(<EnvironmentDependencies />)
    expect(await screen.findByLabelText('settings.dependencies.checkUpdates')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.dependencies.installSettings.title')).toBeInTheDocument()
  })

  it('keeps a system preset display-only, never shadowing it with a managed copy', async () => {
    setSnapshots({ fd: { name: 'fd', availability: { source: 'system', path: '/usr/local/bin/fd' } } })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('fd')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.source.system')
    expect(card.querySelector('[title="/usr/local/bin/fd"]')).toBeInTheDocument()
    // Cherry uses the system binary in place — no install action, no remove.
    expect(within(card).queryByText('settings.dependencies.installManagedCopy')).not.toBeInTheDocument()
    expect(within(card).queryByText('settings.mcp.install')).not.toBeInTheDocument()
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
    expect(ipcMocks.installTool).not.toHaveBeenCalled()
  })

  it('keeps an unowned mise preset display-only without an install retry', async () => {
    setSnapshots({
      gh: { name: 'gh', availability: { source: 'mise', tool: 'gh', path: '/mise/gh', version: '2.0.0' } }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('GitHub CLI')).closest('[role="listitem"]') as HTMLElement
    // A mise-installed but unowned tool is shown read-only — no install retry, no remove.
    expect(within(card).queryByText('settings.mcp.install')).not.toBeInTheDocument()
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('keeps a bundled preset read-only without a remove control', async () => {
    setSnapshots({ uv: { name: 'uv', availability: { source: 'bundled', path: '/bundled/uv', version: '1.0.0' } } })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('shows a remove control for an owned tool', async () => {
    setSnapshots({ gh: miseSnapshot('gh', 'gh', '2.0.0', true) })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('GitHub CLI')).closest('[role="listitem"]') as HTMLElement
    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
  })

  it('renders owned custom tools alongside presets', async () => {
    setSnapshots({ 'my-tool': miseSnapshot('my-tool', 'npm:my-tool', '1.2.3') })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('my-tool')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('v1.2.3')
  })

  it('renders unowned auto runtimes as display-only', async () => {
    setSnapshots({ node: miseSnapshot('node', 'core:node', '22.23.1', false) })
    render(<EnvironmentDependencies />)
    const card = (await screen.findAllByText('node'))[0].closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('settings.dependencies.runtimeDependency')
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
    expect(within(card).queryByTitle('settings.dependencies.update')).not.toBeInTheDocument()
  })

  it('allows an owned runtime to be removed even when unavailable', async () => {
    setSnapshots({
      node: { name: 'node', intent: { name: 'node', tool: 'core:node' }, availability: { source: 'none' } }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('node')).closest('[role="listitem"]') as HTMLElement
    fireEvent.click(within(card).getByLabelText('settings.dependencies.remove'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('settings.dependencies.removeRuntimeConfirmMessage')
  })

  it('keeps owned unavailable custom tools removable and installable for recovery', async () => {
    setSnapshots({
      mytool: { name: 'mytool', intent: { name: 'mytool', tool: 'npm:mytool' }, availability: { source: 'none' } }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
    expect(within(card).getByText('settings.mcp.install')).toBeInTheDocument()
  })

  it('never renders an install retry after an owned tool removal failed', async () => {
    setSnapshots({
      mytool: {
        name: 'mytool',
        intent: { name: 'mytool', tool: 'npm:mytool' },
        availability: { source: 'none' },
        operation: { status: 'failed', action: 'remove', error: 'mise uninstall failed' }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeEnabled()
    expect(within(card).queryByText('common.retry')).not.toBeInTheDocument()
    expect(within(card).queryByText('settings.mcp.install')).not.toBeInTheDocument()
  })

  it('disables conflicting settings actions and shows a removal spinner', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        intent: { name: 'uv', tool: 'uv' },
        availability: { source: 'none' },
        operation: { status: 'removing' }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    expect(await within(card).findByLabelText('settings.dependencies.remove')).toBeDisabled()
    expect(within(card).queryByText('settings.dependencies.installing')).not.toBeInTheDocument()
  })

  it('keeps failed installs retryable', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        availability: { source: 'none' },
        operation: { status: 'failed', action: 'install', error: 'offline' }
      }
    })
    render(<EnvironmentDependencies />)
    expect(await screen.findByText('common.retry')).toBeInTheDocument()
  })

  it('offers ownership retry when a preset install is live but manifest persistence failed', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        availability: { source: 'mise', tool: 'uv', path: '/mise/uv', version: '1.0.0' },
        operation: {
          status: 'failed',
          action: 'install',
          error: 'preference write failed',
          intent: { name: 'uv', tool: 'uv' }
        }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    fireEvent.click(within(card).getByText('common.retry'))
    expect(ipcMocks.installTool).toHaveBeenCalledWith({ intent: { name: 'uv', tool: 'uv' } })
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('renders a failed custom install from operation intent and lets the user retry without ownership', async () => {
    setSnapshots({
      mytool: {
        name: 'mytool',
        availability: { source: 'none' },
        operation: {
          status: 'failed',
          action: 'install',
          error: 'offline',
          intent: { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }
        }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement
    expect(card).toHaveTextContent('npm:mytool')
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
    fireEvent.click(within(card).getByText('common.retry'))
    expect(ipcMocks.installTool).toHaveBeenCalledWith({
      intent: { name: 'mytool', tool: 'npm:mytool', requestedVersion: '1.0.0' }
    })
  })

  it('excludes Code CLI snapshots from the dependency grid', async () => {
    setSnapshots({
      claude: miseSnapshot('claude', 'claude'),
      'some-agent': miseSnapshot('some-agent', 'npm:some-agent')
    })
    render(<EnvironmentDependencies />)
    expect(await screen.findByText('some-agent')).toBeInTheDocument()
    expect(screen.queryByText('claude')).not.toBeInTheDocument()
  })

  it('uses latest versions only for owned tools', async () => {
    setSnapshots({ uv: miseSnapshot('uv', 'uv', '1.0.0'), fd: miseSnapshot('fd', 'fd', '1.0.0', false) })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0', fd: '2.0.0' })
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())
  })

  it('hides remove controls for bundled-only presets', async () => {
    setSnapshots({ uv: { name: 'uv', availability: { source: 'bundled', path: '/bundled/uv', version: '1.0.0' } } })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    expect(within(card).queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('does not render a runtime absent from the live snapshot', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalled())
    expect(screen.queryByText('node')).not.toBeInTheDocument()
  })

  it('shows persistent failed-install details without opening a dialog', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        availability: { source: 'none' },
        operation: { status: 'failed', action: 'install', error: 'offline\\ntimeout' }
      }
    })
    render(<EnvironmentDependencies />)
    expect(await screen.findByText('settings.dependencies.viewErrorDetails')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the install duration hint while an install is in progress', async () => {
    setSnapshots({ uv: { name: 'uv', availability: { source: 'none' }, operation: { status: 'installing' } } })
    render(<EnvironmentDependencies />)
    expect(await screen.findByText('settings.dependencies.installingHint')).toBeInTheDocument()
  })

  it('does not fetch latest versions in mini mode', async () => {
    render(<EnvironmentDependencies mini />)
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalled())
    expect(ipcMocks.latestVersions).not.toHaveBeenCalled()
  })

  it('uses the snapshot route instead of legacy inventory or resolution routes', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalled())
    expect(ipcMocks.snapshots).toHaveBeenCalledWith(expect.arrayContaining(['uv', 'bun', 'fd']))
  })

  it('updates an owned tool with a one-shot target', async () => {
    setSnapshots({ uv: miseSnapshot('uv', 'uv', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.update'))
    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({ intent: { name: 'uv', tool: 'uv' }, targetVersion: '2.0.0' })
    )
  })

  it('refreshes snapshots when availability changes', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalledTimes(1))
    act(() => ipcEventHandlers.get('binary.availability_changed')?.(undefined))
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalledTimes(2))
  })

  it('hides the mini warning when bundled core dependencies are available', async () => {
    setSnapshots({
      uv: { name: 'uv', availability: { source: 'bundled', path: '/bundled/uv' } },
      bun: { name: 'bun', availability: { source: 'bundled', path: '/bundled/bun' } }
    })
    const { container } = render(<EnvironmentDependencies mini />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows the mini warning after unavailable snapshots resolve', async () => {
    const { container } = render(<EnvironmentDependencies mini />)
    await waitFor(() => expect(container.querySelector('button')).toBeInTheDocument())
  })

  it('resets a mirror back to default via the default preset item', async () => {
    installSettingsRef.value = {
      githubMirror: 'https://ghfast.top',
      githubToken: '',
      npmRegistry: '',
      pipIndexUrl: '',
      verifySignatures: true
    }
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.installSettings.title'))
    fireEvent.click(screen.getAllByText('settings.dependencies.installSettings.presetLabels.default')[0])
    fireEvent.click(screen.getByText('common.save'))

    expect(setInstallSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ githubMirror: '' }))
  })

  it('masks the token again when the settings dialog is reopened', async () => {
    render(<EnvironmentDependencies />)
    fireEvent.click(await screen.findByTitle('settings.dependencies.installSettings.title'))
    const token = screen.getByPlaceholderText('settings.dependencies.installSettings.githubToken.placeholder')
    fireEvent.click(screen.getByLabelText('settings.dependencies.installSettings.githubToken.show'))
    expect(token).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByText('common.cancel'))
    fireEvent.click(screen.getByTitle('settings.dependencies.installSettings.title'))
    expect(
      screen.getByPlaceholderText('settings.dependencies.installSettings.githubToken.placeholder')
    ).toHaveAttribute('type', 'password')
  })

  it('claims an unowned runtime with its discovered version pinned in the request', async () => {
    setSnapshots({ node: miseSnapshot('node', 'core:node', '22.23.1', false) })
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

  it('warns before removing an owned managed runtime', async () => {
    setSnapshots({ node: miseSnapshot('node', 'core:node', '22.23.1') })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('node')).closest('[role="listitem"]') as HTMLElement

    expect(within(card).getByTitle('settings.dependencies.update')).toBeInTheDocument()
    fireEvent.click(within(card).getByLabelText('settings.dependencies.remove'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('settings.dependencies.removeRuntimeConfirmMessage')
  })

  it('keeps an unavailable unowned runtime absent from the snapshot inventory', async () => {
    setSnapshots({ node: { name: 'node', availability: { source: 'none' } } })
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalled())

    expect(screen.queryByText('node')).not.toBeInTheDocument()
  })

  it('keeps manifest-owned system tools owned and removable', async () => {
    setSnapshots({
      mytool: {
        name: 'mytool',
        intent: { name: 'mytool', tool: 'npm:mytool' },
        availability: { source: 'system', path: '/usr/local/bin/mytool' }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('mytool')).closest('[role="listitem"]') as HTMLElement

    expect(card).toHaveTextContent('settings.dependencies.source.system')
    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
    expect(within(card).queryByText('settings.mcp.install')).not.toBeInTheDocument()
  })

  it('retries an owned preset at its pinned version when the binary is missing', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        intent: { name: 'uv', tool: 'uv', requestedVersion: '0.9.0' },
        availability: { source: 'none' }
      }
    })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement

    expect(within(card).getByLabelText('settings.dependencies.remove')).toBeInTheDocument()
    fireEvent.click(within(card).getByText('settings.mcp.install'))
    await waitFor(() =>
      expect(ipcMocks.installTool).toHaveBeenCalledWith({
        intent: { name: 'uv', tool: 'uv', requestedVersion: '0.9.0' }
      })
    )
  })

  it('rejects adding a tool that already exists in the owned snapshots', async () => {
    setSnapshots({ node: miseSnapshot('node', 'core:node', '22.23.1') })
    ipcMocks.searchRegistry.mockResolvedValue([{ name: 'node', tool: 'core:node' }])
    render(<EnvironmentDependencies />)

    fireEvent.click(screen.getByText('settings.dependencies.addTool'))
    fireEvent.change(screen.getByPlaceholderText('settings.dependencies.searchRegistry'), {
      target: { value: 'node' }
    })
    fireEvent.click(await screen.findByRole('button', { name: /core:node/ }))
    fireEvent.click(screen.getByText('common.add'))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('settings.dependencies.duplicateName'))
    expect(ipcMocks.installTool).not.toHaveBeenCalled()
  })

  it('rejects a reserved Code CLI name even when no CLI snapshot is displayed', async () => {
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

  it('shows no mini warning when system core dependencies are available', async () => {
    setSnapshots({
      uv: { name: 'uv', availability: { source: 'system', path: '/usr/local/bin/uv' } },
      bun: { name: 'bun', availability: { source: 'system', path: '/usr/local/bin/bun' } }
    })
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('waits for the snapshot request before showing the mini warning', async () => {
    let resolveSnapshots: (records: Record<string, BinaryToolSnapshot>) => void = () => undefined
    const pendingSnapshots = new Promise<Record<string, BinaryToolSnapshot>>((resolve) => {
      resolveSnapshots = resolve
    })
    ipcMocks.snapshots.mockReturnValueOnce(pendingSnapshots)
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    resolveSnapshots({})
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
  })

  it('keeps the mini warning hidden when the snapshot request fails', async () => {
    ipcMocks.snapshots.mockRejectedValueOnce(new Error('not ready'))
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.snapshots).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('does not show an update for an incomparable installed version', async () => {
    setSnapshots({ uv: miseSnapshot('uv', 'uv', 'nightly') })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    expect(card).toHaveTextContent('vnightly')
    expect(within(card).queryByText('v2.0.0')).not.toBeInTheDocument()
    expect(within(card).getByTitle('settings.dependencies.update')).toBeInTheDocument()
  })

  it('does not show an update when the latest version equals the installed version', async () => {
    vi.mocked(semverGt).mockReturnValue(false)
    setSnapshots({ uv: miseSnapshot('uv', 'uv', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '1.0.0' })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    expect(within(card).getAllByText('v1.0.0')).toHaveLength(1)
    expect(within(card).getByTitle('settings.dependencies.update')).toBeInTheDocument()
  })

  it('does not show an update for a non-semver latest version', async () => {
    setSnapshots({ uv: miseSnapshot('uv', 'uv', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ uv: 'nightly' })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement

    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
    expect(within(card).queryByText('vnightly')).not.toBeInTheDocument()
    expect(within(card).getByTitle('settings.dependencies.update')).toBeInTheDocument()
  })

  it('clears latest versions when availability changes', async () => {
    setSnapshots({ uv: miseSnapshot('uv', 'uv', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ uv: '2.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('v2.0.0')).toBeInTheDocument())
    act(() => ipcEventHandlers.get('binary.availability_changed')?.(undefined))

    await waitFor(() => expect(screen.queryByText('v2.0.0')).not.toBeInTheDocument())
  })

  it('fetches latest versions on mount', async () => {
    render(<EnvironmentDependencies />)
    await waitFor(() => expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false))
  })

  it('shows persistent failed-install details on demand', async () => {
    setSnapshots({
      uv: {
        name: 'uv',
        availability: { source: 'none' },
        operation: { status: 'failed', action: 'install', error: 'mise failed\nnetwork timeout' }
      }
    })
    render(<EnvironmentDependencies />)
    const failureRow = await screen.findByText('settings.dependencies.viewErrorDetails')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(failureRow)
    expect(await screen.findByRole('dialog')).toHaveTextContent('mise failed')
    expect(screen.getByRole('dialog')).toHaveTextContent('network timeout')
    expect(screen.getByRole('dialog')).toHaveTextContent('settings.dependencies.installErrorHint')
  })

  it('renders an in-flight install when mounting mid-operation', async () => {
    setSnapshots({ uv: { name: 'uv', availability: { source: 'none' }, operation: { status: 'installing' } } })
    render(<EnvironmentDependencies />)

    expect(await screen.findByText('settings.dependencies.installing')).toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.installingHint')).toBeInTheDocument()
  })

  it('offers removal for an owned preset', async () => {
    setSnapshots({ uv: miseSnapshot('uv') })
    render(<EnvironmentDependencies />)
    const card = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement

    fireEvent.click(within(card).getByLabelText('settings.dependencies.remove'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('settings.dependencies.removeConfirmMessage')
  })
})
