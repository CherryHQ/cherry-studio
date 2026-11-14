import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { McpServer } from '@shared/data/types/mcpServer'

import { McpCapabilityList } from '../McpCapabilityList'

const { mcp, toastError } = vi.hoisted(() => ({
  mcp: { servers: [] as Partial<McpServer>[], addMcpServer: vi.fn() },
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: mcp.servers, addMcpServer: mcp.addMcpServer, isLoading: false })
}))
vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({ useMcpRuntimeStatusMap: () => ({}) }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('@renderer/components/mcp/QuickCreateMcpServerDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="quick create" /> : null)
}))
vi.mock('@renderer/components/mcp/AddMcpServerModal', () => ({
  default: ({ visible, initialImportMethod }: { visible: boolean; initialImportMethod: string }) =>
    visible ? <div role="dialog" aria-label={`import ${initialImportMethod}`} /> : null
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

const FETCH = '@cherry/fetch'
const ENABLE_ALL = 'library.config.agent.section.tools.skills_enable_all'

function Harness() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  return (
    <>
      <McpCapabilityList
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        emptyLabel="No MCP servers"
        portalContainer={null}
      />
      <output data-testid="selected">{selectedIds.join(',')}</output>
    </>
  )
}

describe('McpCapabilityList', () => {
  beforeEach(() => {
    mcp.servers = [{ id: 'mcp-github', name: 'GitHub', type: 'stdio', isActive: true }]
    mcp.addMcpServer.mockReset()
    toastError.mockReset()
  })

  it('offers featured servers that need no configuration, never ones that do', () => {
    render(<Harness />)

    expect(screen.getByRole('switch', { name: FETCH })).not.toBeChecked()
    expect(screen.queryByRole('switch', { name: '@cherry/brave-search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '@cherry/browser' })).not.toBeInTheDocument()
  })

  it('installs a featured server once, active, and binds its new ID', async () => {
    const user = userEvent.setup()
    let finishInstall: (server: Partial<McpServer>) => void = () => {}
    mcp.addMcpServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = resolve
        })
    )
    render(<Harness />)

    await user.click(screen.getByRole('switch', { name: FETCH }))
    expect(screen.getByRole('switch', { name: FETCH })).toHaveAttribute('aria-busy', 'true')
    await user.click(screen.getByRole('switch', { name: FETCH }))

    finishInstall({ id: 'mcp-fetch-new', name: FETCH })
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('mcp-fetch-new'))
    expect(mcp.addMcpServer).toHaveBeenCalledTimes(1)
    expect(mcp.addMcpServer.mock.calls[0][0]).toMatchObject({ name: FETCH, isActive: true })
  })

  it('leaves a featured server off and reports the error when it fails to install', async () => {
    const user = userEvent.setup()
    mcp.addMcpServer.mockRejectedValue(new Error('npm offline'))
    render(<Harness />)

    await user.click(screen.getByRole('switch', { name: FETCH }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('npm offline')))
    expect(screen.getByRole('switch', { name: FETCH })).not.toBeChecked()
    expect(screen.getByTestId('selected').textContent).toBe('')
  })

  it('enables installed servers with Enable all without installing featured ones', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('switch', { name: ENABLE_ALL }))

    expect(screen.getByTestId('selected').textContent).toBe('mcp-github')
    expect(mcp.addMcpServer).not.toHaveBeenCalled()
  })

  it('offers adding manually or importing JSON, each in its own dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'library.config.tools.add_mcp' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'library.config.tools.add_manually',
      'settings.mcp.addServer.importFrom.json'
    ])
    await user.click(screen.getByRole('menuitem', { name: 'settings.mcp.addServer.importFrom.json' }))
    expect(screen.getByRole('dialog', { name: 'import json' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'library.config.tools.add_mcp' }))
    await user.click(screen.getByRole('menuitem', { name: 'library.config.tools.add_manually' }))
    expect(screen.getByRole('dialog', { name: 'quick create' })).toBeInTheDocument()
  })
})
