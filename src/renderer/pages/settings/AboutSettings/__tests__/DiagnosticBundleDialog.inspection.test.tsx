import '@testing-library/jest-dom/vitest'

import { DIALOG_CLOSE_DURATION_MS } from '@cherrystudio/ui/utils'
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

import DiagnosticBundleDialog from '../DiagnosticBundleDialog'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  hasWarnings: false,
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    crashDumps: { fileCount: 1 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 2 },
    traces: { available: true, estimatedBytes: 2_048, fileCount: 3 }
  }
}

function renderDialog() {
  render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={vi.fn()} />)
}

describe('DiagnosticBundleDialog inspection state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', { process: { platform: 'darwin' } })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      return undefined
    })
  })

  it('describes sources as pending instead of unavailable while inspection is running', async () => {
    let resolveInspection: (value: OutputFor<'diagnostics.bundle.inspect'>) => void = () => undefined
    mocks.request.mockImplementation((route: string) => {
      if (route !== 'diagnostics.bundle.inspect') return Promise.resolve(undefined)
      return new Promise((resolve) => {
        resolveInspection = resolve
      })
    })

    renderDialog()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    expect(screen.getAllByText('settings.about.diagnostics.sources.inspecting')).toHaveLength(2)
    expect(screen.queryByText('settings.about.diagnostics.sources.unavailable')).not.toBeInTheDocument()

    await act(async () => resolveInspection(inspectResult))
    await waitFor(() =>
      expect(screen.queryByText('settings.about.diagnostics.sources.inspecting')).not.toBeInTheDocument()
    )
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
    renderDialog()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    const exportButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
    expect(exportButton).toBeDisabled()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))

    const empty3dResult = {
      ...inspectResult,
      sources: {
        ...inspectResult.sources,
        logs: { available: false, estimatedBytes: 0, fileCount: 0 },
        traces: { available: false, estimatedBytes: 0, fileCount: 0 }
      }
    }
    await act(async () => resolve3d(empty3dResult))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'settings.about.diagnostics.sources.logs.title' })).toBeDisabled()
    )

    await act(async () => resolve24h(inspectResult))
    expect(screen.getByRole('switch', { name: 'settings.about.diagnostics.sources.logs.title' })).toBeDisabled()
  })

  it('resets the range after the close animation before inspecting on reopen', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))

    rerender(<DiagnosticBundleDialog appVersion="2.0.0" open={false} onOpenChange={onOpenChange} />)
    await act(() => new Promise((resolve) => window.setTimeout(resolve, DIALOG_CLOSE_DURATION_MS)))
    mocks.request.mockClear()
    rerender(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={onOpenChange} />)

    await waitFor(() => {
      const inspectCalls = mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.inspect')
      expect(inspectCalls).toEqual([['diagnostics.bundle.inspect', { range: '24h' }]])
    })
  })

  it('shows a warning when source inspection is incomplete', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return { ...inspectResult, hasWarnings: true }
      return undefined
    })

    renderDialog()

    expect(await screen.findByText('settings.about.diagnostics.warning')).toBeInTheDocument()
  })
})
