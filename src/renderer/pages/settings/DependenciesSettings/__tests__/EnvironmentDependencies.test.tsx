import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const customToolsRef = vi.hoisted(() => ({ value: [] as Array<{ name: string; tool: string; version?: string }> }))
const setCustomToolsMock = vi.hoisted(() => vi.fn())

const installSettingsRef = vi.hoisted(() => ({
  value: { githubMirror: '', githubToken: '', npmRegistry: '', pipIndexUrl: '', verifySignatures: true }
}))
const setInstallSettingsMock = vi.hoisted(() => vi.fn())
const navigateMock = vi.hoisted(() => vi.fn())

const ipcMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  probeBundled: vi.fn(),
  probeSystem: vi.fn(),
  latestVersions: vi.fn(),
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getToolDir: vi.fn()
}))
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

// Route ipcApi.request by binary.* route to the per-method mocks above.
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input?: unknown) => {
      switch (route) {
        case 'binary.get_state':
          return ipcMocks.getState()
        case 'binary.probe_bundled':
          return ipcMocks.probeBundled()
        case 'binary.probe_system':
          return ipcMocks.probeSystem(input)
        case 'binary.install_tool':
          return ipcMocks.installTool(input)
        case 'binary.remove_tool':
          return ipcMocks.removeTool(input)
        case 'binary.get_tool_dir':
          return ipcMocks.getToolDir(input)
        case 'binary.get_latest_versions':
          return ipcMocks.latestVersions(input)
        default:
          throw new Error(`unexpected route: ${route}`)
      }
    }
  },
  useIpcOn: vi.fn((event: string, handler: (payload: unknown) => void) => {
    ipcEventHandlers.set(event, handler)
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'feature.binary.install_settings'
      ? [installSettingsRef.value, setInstallSettingsMock]
      : [customToolsRef.value, setCustomToolsMock]
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
  // Render children only — these carry non-DOM props (onOpenChange, onConfirm,
  // destructive, open) that React would warn about if spread onto a div.
  const childrenOnly = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
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
    // Accordion groups always render their content in tests (no collapse behavior).
    Accordion: childrenOnly,
    AccordionItem: childrenOnly,
    AccordionTrigger: childrenOnly,
    AccordionContent: childrenOnly,
    // Render the trigger (its child) directly; the tooltip content is irrelevant here.
    NormalTooltip: ({ children }: { children?: React.ReactNode }) => children,
    Dialog: childrenOnly,
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('div'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('div'),
    Input: passthrough('input'),
    // Install-settings primitives. Field wrappers just render children; the
    // interactive stubs preserve the props the tests drive. The dialog is the
    // childrenOnly Dialog stub above, so fields render without opening it.
    Field: passthrough('div'),
    FieldLabel: passthrough('label'),
    FieldDescription: passthrough('div'),
    InputGroup: passthrough('div'),
    InputGroupAddon: passthrough('div'),
    InputGroupInput: passthrough('input'),
    InputGroupButton: ({
      children,
      onClick,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      onClick?: () => void
      'aria-label'?: string
    }) => React.createElement('button', { type: 'button', onClick, 'aria-label': ariaLabel }, children),
    DescriptionSwitch: ({
      label,
      checked,
      onCheckedChange
    }: {
      label: string
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) =>
      React.createElement('label', null, [
        label,
        React.createElement('input', {
          key: 'switch',
          type: 'checkbox',
          checked: !!checked,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(e.target.checked)
        })
      ]),
    // Renders each preset as a button so a click drives onSelect(url) — exercises
    // "pick a preset fills the field" without the real popover.
    SelectDropdown: ({
      items,
      onSelect,
      placeholder
    }: {
      items: Array<{ id: string; label: string }>
      onSelect: (id: string) => void
      placeholder?: string
    }) =>
      React.createElement('div', null, [
        React.createElement('span', { key: 'placeholder' }, placeholder),
        ...items.map((it) =>
          React.createElement('button', { key: it.id, type: 'button', onClick: () => onSelect(it.id) }, it.label)
        )
      ])
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
    ipcMocks.getToolDir.mockResolvedValue('/dir')
  })

  it('renders preset tools across the runtime and CLI groups', async () => {
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    // Runtime-group displayNames render regardless of install state.
    expect(screen.getByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
    // Third-party CLI preset also renders.
    expect(screen.getByText('GitHub CLI')).toBeInTheDocument()
  })

  it('renders a persisted custom tool in the third-party CLI group', async () => {
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
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
    expect(screen.queryByLabelText('settings.dependencies.remove')).not.toBeInTheDocument()
  })

  it('marks a system-PATH CLI preset as available with only the low-key managed install', async () => {
    // fd (third-party CLI) found on the user's PATH (source 'system') → "System"
    // badge and a low-key icon to pull in a Cherry-managed copy — never the CTA.
    // (Runtime deps like uv show no install action at all; CLIs still can.)
    ipcMocks.probeSystem.mockResolvedValue({ fd: '/usr/local/bin/fd' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.probeSystem).toHaveBeenCalled())
    const fdCard = (await screen.findByText('fd')).closest('[role="listitem"]') as HTMLElement
    expect(within(fdCard).getByText('settings.dependencies.source.system')).toBeInTheDocument()
    expect(within(fdCard).getByLabelText('settings.dependencies.installManaged')).toBeInTheDocument()
    expect(within(fdCard).queryByText('settings.dependencies.install')).not.toBeInTheDocument()
  })

  it('shows no install action for a runtime dependency that is only bundled', async () => {
    // uv is a runtime dep → its card never offers install/managed-copy actions,
    // even when present only as bundled.
    ipcMocks.probeBundled.mockResolvedValue({ uv: '1.0.0' })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.probeBundled).toHaveBeenCalled())
    const uvCard = (await screen.findByText('uv')).closest('[role="listitem"]') as HTMLElement
    expect(within(uvCard).queryByLabelText('settings.dependencies.installManaged')).not.toBeInTheDocument()
    expect(within(uvCard).queryByText('settings.dependencies.install')).not.toBeInTheDocument()
  })

  it('opens an installed coding agent in the Code Tools launcher', async () => {
    // claude is mise-managed → the coding-agents card offers "Open in Code Tools",
    // which deep-links to /app/code with the launcher's dialog auto-opened.
    ipcMocks.getState.mockResolvedValue({ tools: { claude: { version: '1.0.0' } } })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    fireEvent.click(await screen.findByText('settings.dependencies.openInCodeTools'))

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: '/app/code', search: { launch: 'claude-code' } })
    )
  })

  it('does not offer Open for a coding agent that is not installed', async () => {
    // Nothing installed → no agent card shows the open affordance.
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    expect(screen.queryByText('settings.dependencies.openInCodeTools')).not.toBeInTheDocument()
  })

  it('surfaces a failed install in a persistent, copyable error dialog', async () => {
    // A failed install must not vanish like a toast: the full mise log stays on
    // screen and is copyable so the user can read it or paste it to an AI.
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    ipcMocks.installTool.mockRejectedValue(new Error('boom: mise blew up'))
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.mcp.install'))

    await waitFor(() => expect(screen.getByText('boom: mise blew up')).toBeInTheDocument())
    expect(screen.getByText('settings.dependencies.installError: mytool')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.copy'))
    expect(writeTextMock).toHaveBeenCalledWith('boom: mise blew up')
  })

  it('renders nothing in mini mode once core deps are available', async () => {
    ipcMocks.probeBundled.mockResolvedValue({ uv: '1.0.0', bun: '1.0.0' })
    const { container } = render(<EnvironmentDependencies mini />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(ipcMocks.probeBundled).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
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
      ipcEventHandlers.get('binary.state_changed')?.({ tools: { uv: { version: '1.0.0' } } })
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

  describe('install settings section', () => {
    const placeholderOf = (key: string) => `settings.dependencies.installSettings.${key}`

    it('persists a typed value into the install-settings preference', async () => {
      render(<EnvironmentDependencies />)
      await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

      const mirror = screen.getByPlaceholderText(placeholderOf('githubMirror.placeholder'))
      fireEvent.change(mirror, { target: { value: 'https://my.mirror' } })

      expect(setInstallSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ githubMirror: 'https://my.mirror' })
      )
    })

    it('fills the field with the chosen preset URL, not its label', async () => {
      render(<EnvironmentDependencies />)
      await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

      // The mirror field's preset dropdown renders each preset as a button.
      fireEvent.click(screen.getByText('ghfast.top'))

      expect(setInstallSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ githubMirror: 'https://ghfast.top' })
      )
    })

    it('masks the GitHub token by default and reveals it on toggle', async () => {
      render(<EnvironmentDependencies />)
      await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

      const token = screen.getByPlaceholderText('ghp_…')
      expect(token).toHaveAttribute('type', 'password')

      // Reveal toggles the local show-token state; waitFor flushes the update inside act().
      fireEvent.click(screen.getByLabelText(placeholderOf('githubToken.show')))
      await waitFor(() => expect(screen.getByPlaceholderText('ghp_…')).toHaveAttribute('type', 'text'))
    })

    it('writes the boolean when the verify-signatures switch is toggled off', async () => {
      render(<EnvironmentDependencies />)
      await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())

      // Default on → toggling emits verifySignatures:false.
      fireEvent.click(screen.getByRole('checkbox'))

      expect(setInstallSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ verifySignatures: false }))
    })
  })
})
