import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EnvironmentDependencies from '../EnvironmentDependencies'

const customToolsRef = vi.hoisted(() => ({ value: [] as Array<{ name: string; tool: string; version?: string }> }))
const setCustomToolsMock = vi.hoisted(() => vi.fn())

const ipcMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  probeBundled: vi.fn(),
  installTool: vi.fn(),
  removeTool: vi.fn(),
  getToolDir: vi.fn()
}))

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
        default:
          throw new Error(`unexpected route: ${route}`)
      }
    }
  }
}))

// Event subscriptions are inert in these tests — refreshState drives all UI state.
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

// The shared global @cherrystudio/ui mock omits ConfirmDialog / DialogDescription
// that this component renders, so stub exactly what it imports here.
vi.mock('@cherrystudio/ui', () => {
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children)
  // Render children only — these carry non-DOM props (onOpenChange, onConfirm,
  // destructive, open) that React would warn about if spread onto a div.
  const childrenOnly = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return {
    Badge: passthrough('span'),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick }, children),
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
    customToolsRef.value = []
    ipcMocks.getState.mockResolvedValue({ tools: {} })
    ipcMocks.probeBundled.mockResolvedValue({})
    ipcMocks.installTool.mockResolvedValue(undefined)
    ipcMocks.removeTool.mockResolvedValue(undefined)
    ipcMocks.getToolDir.mockResolvedValue('/dir')
    window.toast = { error: vi.fn(), success: vi.fn() } as unknown as typeof window.toast
  })

  it('renders preset tools and the empty custom-tools state', async () => {
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(ipcMocks.getState).toHaveBeenCalled())
    // Preset displayNames render regardless of install state.
    expect(screen.getByText('Bun')).toBeInTheDocument()
    expect(screen.getByText('ripgrep')).toBeInTheDocument()
    // No custom tools → empty-state hint.
    expect(screen.getByText('settings.plugins.customToolsEmpty')).toBeInTheDocument()
  })

  it('renders a persisted custom tool instead of the empty state', async () => {
    customToolsRef.value = [{ name: 'mytool', tool: 'npm:mytool' }]
    render(<EnvironmentDependencies />)

    await waitFor(() => expect(screen.getByText('mytool')).toBeInTheDocument())
    expect(screen.queryByText('settings.plugins.customToolsEmpty')).not.toBeInTheDocument()
  })

  it('renders nothing in mini mode once core deps are available', async () => {
    ipcMocks.probeBundled.mockResolvedValue({ uv: '1.0.0', bun: '1.0.0' })
    const { container } = render(<EnvironmentDependencies mini />)

    await waitFor(() => expect(ipcMocks.probeBundled).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
