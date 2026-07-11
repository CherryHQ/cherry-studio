import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const customToolsRef = vi.hoisted(() => ({ value: [] as Array<{ name: string; tool: string; version?: string }> }))
const setCustomToolsMock = vi.hoisted(() => vi.fn())

const ipcMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  probeBundled: vi.fn(),
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
        case 'binary.install_tool':
          return ipcMocks.installTool(input)
        case 'binary.remove_tool':
          return ipcMocks.removeTool(input)
        case 'binary.get_tool_dir':
          return ipcMocks.getToolDir(input)
        case 'local_model.get_status':
          return Promise.resolve({ status: 'unsupported' })
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

vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
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
    Dialog: childrenOnly,
    DialogContent: passthrough('div'),
    DialogDescription: passthrough('div'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('div'),
    Input: passthrough('input')
  }
})

describe('EnvironmentDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    customToolsRef.value = []
    ipcMocks.getState.mockResolvedValue({ tools: {} })
    ipcMocks.probeBundled.mockResolvedValue({})
    ipcMocks.latestVersions.mockResolvedValue({})
    ipcMocks.installTool.mockResolvedValue(undefined)
    ipcMocks.removeTool.mockResolvedValue(undefined)
    ipcMocks.getToolDir.mockResolvedValue('/dir')
  })

  it('renders preset tools and the empty custom-tools state', async () => {
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    // Preset displayNames render regardless of install state.
    expect(screen.getByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
    // No custom tools → empty-state hint.
    expect(screen.getByText('settings.dependencies.customToolsEmpty')).toBeInTheDocument()
  })

  it('renders a persisted custom tool instead of the empty state', async () => {
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
    expect(screen.queryByText('settings.dependencies.customToolsEmpty')).not.toBeInTheDocument()
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
})
