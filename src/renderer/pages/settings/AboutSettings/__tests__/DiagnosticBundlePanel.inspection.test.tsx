import '@testing-library/jest-dom/vitest'

import type { OutputFor } from '@shared/ipc/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import DiagnosticBundlePanel from '@renderer/components/feedback/DiagnosticBundlePanel'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  hasWarnings: false,
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    chatRecords: { available: true, estimatedBytes: 4_096, messageCount: 4 },
    crashDumps: { fileCount: 1 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 2 },
    traces: { available: true, estimatedBytes: 2_048, fileCount: 3 }
  }
}

const logsSwitchName = /^settings\.about\.diagnostics\.sources\.logs\.title /

function renderPanel() {
  render(<DiagnosticBundlePanel appVersion="2.0.0" onClose={vi.fn()} />)
}

describe('DiagnosticBundlePanel inspection state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', { process: { platform: 'darwin' } })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      return undefined
    })
  })

  it('keeps one status node mounted while range inspection feedback changes', async () => {
    const user = userEvent.setup()
    let resolve24h: (value: OutputFor<'diagnostics.bundle.inspect'>) => void = () => undefined
    let resolve3d: (value: OutputFor<'diagnostics.bundle.inspect'>) => void = () => undefined
    mocks.request.mockImplementation((route: string, input?: { range?: string }) => {
      if (route !== 'diagnostics.bundle.inspect') return Promise.resolve(undefined)
      return new Promise((resolve) => {
        if (input?.range === '3d') resolve3d = resolve
        else resolve24h = resolve
      })
    })

    renderPanel()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    expect(screen.getAllByText('settings.about.diagnostics.sources.inspecting')).toHaveLength(3)
    expect(screen.queryByText('settings.about.diagnostics.sources.unavailable')).not.toBeInTheDocument()
    // The live announcement must not add a normal-flow row that changes the centered dialog height.
    const inspectionStatus = screen.getByRole('status')
    expect(inspectionStatus).toHaveClass('sr-only')
    expect(inspectionStatus.parentElement).not.toHaveClass('space-y-4')
    expect(inspectionStatus).toHaveTextContent('settings.about.diagnostics.inspecting')

    await act(async () => resolve24h(inspectResult))
    await waitFor(() =>
      expect(screen.queryByText('settings.about.diagnostics.sources.inspecting')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('status')).toBe(inspectionStatus)
    expect(inspectionStatus).toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))
    expect(screen.getByRole('status')).toBe(inspectionStatus)
    expect(inspectionStatus).toHaveTextContent('settings.about.diagnostics.inspecting')

    await act(async () => resolve3d(inspectResult))
    await waitFor(() => expect(inspectionStatus).toBeEmptyDOMElement())
  })

  it('ignores stale inspection results and disables export while a new range is inspected', async () => {
    const user = userEvent.setup()
    let resolve24h: (value: OutputFor<'diagnostics.bundle.inspect'>) => void = () => undefined
    let resolve3d: (value: OutputFor<'diagnostics.bundle.inspect'>) => void = () => undefined
    mocks.request.mockImplementation((route: string, input?: { range?: string }) => {
      if (route !== 'diagnostics.bundle.inspect') return Promise.resolve(undefined)
      return new Promise((resolve) => {
        if (input?.range === '3d') resolve3d = resolve
        else resolve24h = resolve
      })
    })
    renderPanel()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    const exportButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
    expect(exportButton).toBeDisabled()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))

    const empty3dResult = {
      ...inspectResult,
      sources: {
        ...inspectResult.sources,
        chatRecords: { available: false, estimatedBytes: 0, messageCount: 0 },
        logs: { available: false, estimatedBytes: 0, fileCount: 0 },
        traces: { available: false, estimatedBytes: 0, fileCount: 0 }
      }
    }
    await act(async () => resolve3d(empty3dResult))
    await waitFor(() => expect(screen.getByRole('switch', { name: logsSwitchName })).toBeDisabled())

    await act(async () => resolve24h(inspectResult))
    expect(screen.getByRole('switch', { name: logsSwitchName })).toBeDisabled()
  })

  it('shows a warning when source inspection is incomplete', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return { ...inspectResult, hasWarnings: true }
      return undefined
    })

    renderPanel()

    expect(await screen.findByText('settings.about.diagnostics.warning')).toBeInTheDocument()
  })
})
