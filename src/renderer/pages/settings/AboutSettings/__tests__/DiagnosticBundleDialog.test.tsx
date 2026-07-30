import '@testing-library/jest-dom/vitest'

import type { OutputFor } from '@shared/ipc/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  loggerError: vi.fn(),
  request: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'settings.about.diagnostics.mail.subject') return `Diagnostics ${values?.bundleId}`
      if (key === 'settings.about.diagnostics.mail.body') {
        return [
          `ID ${values?.bundleId}`,
          `Version ${values?.version}`,
          `Platform ${values?.platform}`,
          `Range ${values?.range}`,
          `File ${values?.fileName}`
        ].join('\n')
      }
      return key
    }
  })
}))

import DiagnosticBundleDialog from '../DiagnosticBundleDialog'

const inspectResult: OutputFor<'diagnostics.bundle.inspect'> = {
  range: { from: '2026-07-29T00:00:00.000Z', to: '2026-07-30T00:00:00.000Z' },
  sourceLimitBytes: 50 * 1024 * 1024,
  sources: {
    crashDumps: { available: true, estimatedBytes: 100, fileCount: 1 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 2 },
    traces: { available: true, estimatedBytes: 2_048, fileCount: 3 }
  },
  warnings: []
}

const savedResult: Extract<OutputFor<'diagnostics.bundle.export'>, { status: 'saved' }> = {
  archiveBytes: 2_000,
  bundleId: 'bundle-123',
  fileName: 'cherry-studio-diagnostics.zip',
  included: {
    logs: { bytes: 1_000, fileCount: 1, malformedLineCount: 0 },
    traces: { bytes: 1_000, fileCount: 1, malformedLineCount: 0 }
  },
  omitted: {
    logs: { bytes: 0, fileCount: 0, malformedLineCount: 0 },
    traces: { bytes: 0, fileCount: 0, malformedLineCount: 0 }
  },
  range: inspectResult.range,
  status: 'saved',
  warnings: []
}

function renderDialog() {
  render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={vi.fn()} />)
}

async function confirmSensitiveExport() {
  fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' }))
  const confirmation = screen.getAllByRole('dialog').at(-1)!
  const checkbox = within(confirmation).getByRole('checkbox')
  const confirmButton = within(confirmation).getByRole('button', {
    name: 'settings.about.diagnostics.actions.export'
  })
  fireEvent.click(checkbox)
  await act(async () => {
    fireEvent.click(confirmButton)
    await Promise.resolve()
  })
}

describe('DiagnosticBundleDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', { process: { platform: 'darwin' } })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboardWrite }
    })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') return savedResult
      if (route === 'diagnostics.bundle.reveal') return true
      return undefined
    })
  })

  it('shows sensitive data confirmation only after export is requested', async () => {
    renderDialog()

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))
    expect(screen.getByRole('switch', { name: 'settings.about.diagnostics.sources.logs.title' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'settings.about.diagnostics.sources.traces.title' })).toBeChecked()
    expect(screen.queryByText('settings.about.diagnostics.privacy.title')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    const exportButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)

    const confirmation = screen.getAllByRole('dialog').at(-1)!
    expect(within(confirmation).getByText('settings.about.diagnostics.privacy.title')).toBeInTheDocument()
    expect(confirmation.querySelector('.bg-warning-subtle')).not.toBeInTheDocument()
    expect(confirmation.querySelector('.border-warning-border')).not.toBeInTheDocument()
    const checkbox = within(confirmation).getByRole('checkbox')
    expect(checkbox.closest('label')).toHaveClass('items-center')
    expect(checkbox).not.toHaveClass('mt-0.5')
    const confirmButton = within(confirmation).getByRole('button', {
      name: 'settings.about.diagnostics.actions.export'
    })
    expect(confirmButton).toBeDisabled()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.export')).toHaveLength(0)

    fireEvent.click(checkbox)
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.export', {
        includeLogs: true,
        includeTraces: true,
        range: '24h'
      })
    )
    expect(await screen.findByText('settings.about.diagnostics.success.title')).toBeInTheDocument()
  })

  it('keeps the header and actions visible while the diagnostic details scroll', async () => {
    renderDialog()
    await screen.findByText('settings.about.diagnostics.sources.logs.title')

    const content = screen.getByTestId('dialog-content')
    const header = screen.getByTestId('dialog-header')
    const scrollbar = screen.getByTestId('scrollbar')
    const footer = screen.getByTestId('dialog-footer')

    expect(content).toHaveClass('max-h-[calc(100vh-2rem)]', 'grid-rows-[auto_minmax(0,1fr)_auto]', 'overflow-hidden')
    expect(scrollbar).toHaveClass('min-h-0')
    expect(Array.from(content.children)).toEqual([header, scrollbar, footer])
  })

  it('reveals the saved file and prepares a private support email without a local path', async () => {
    renderDialog()
    await screen.findByText('settings.about.diagnostics.sources.logs.title')
    await confirmSensitiveExport()
    await screen.findByText('settings.about.diagnostics.success.title')

    fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.reveal' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.reveal'))

    fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.contact' }))
    await waitFor(() => {
      const mailCall = mocks.request.mock.calls.find(([route]) => route === 'system.shell.open_website')
      expect(mailCall).toBeDefined()
      const mailto = String(mailCall?.[1])
      expect(mailto).toMatch(/^mailto:support@cherry-ai\.com\?/)
      expect(decodeURIComponent(mailto)).toContain('bundle-123')
      expect(decodeURIComponent(mailto)).toContain('cherry-studio-diagnostics.zip')
      expect(decodeURIComponent(mailto)).not.toContain('/Users/')
      expect(decodeURIComponent(mailto)).not.toContain('/tmp/')
    })
  })

  it('allows a system-only export without consent when no logs or traces are available', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') {
        return {
          ...inspectResult,
          sources: {
            ...inspectResult.sources,
            logs: { available: false, estimatedBytes: 0, fileCount: 0 },
            traces: { available: false, estimatedBytes: 0, fileCount: 0 }
          }
        }
      }
      if (route === 'diagnostics.bundle.export') return { status: 'canceled' }
      return undefined
    })
    renderDialog()

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'settings.about.diagnostics.sources.logs.title' })).toBeDisabled()
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    const exportButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.export', {
        includeLogs: false,
        includeTraces: false,
        range: '24h'
      })
    )
  })

  it('ignores stale inspection results and disables export while a new range is inspected', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
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

  it('resets the range while closed before inspecting on reopen', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '24h' }))

    fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.ranges.3d' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('diagnostics.bundle.inspect', { range: '3d' }))

    rerender(<DiagnosticBundleDialog appVersion="2.0.0" open={false} onOpenChange={onOpenChange} />)
    mocks.request.mockClear()
    rerender(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={onOpenChange} />)

    await waitFor(() => {
      const inspectCalls = mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.inspect')
      expect(inspectCalls).toEqual([['diagnostics.bundle.inspect', { range: '24h' }]])
    })
  })

  it('shows a warning when source inspection is incomplete', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') {
        return { ...inspectResult, warnings: ['source_unreadable'] }
      }
      return undefined
    })

    renderDialog()

    expect(await screen.findByText('settings.about.diagnostics.warning')).toBeInTheDocument()
  })

  it('shows a warning when the saved bundle is incomplete', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') {
        return { ...savedResult, warnings: ['system_info_unavailable'] }
      }
      return undefined
    })
    renderDialog()
    await screen.findByText('settings.about.diagnostics.sources.logs.title')

    await confirmSensitiveExport()

    expect(await screen.findByText('settings.about.diagnostics.warning')).toBeInTheDocument()
  })

  it('prevents duplicate exports and requires fresh consent after a canceled attempt', async () => {
    let resolveExport: (value: { status: 'canceled' }) => void = () => undefined
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') {
        return new Promise((resolve) => {
          resolveExport = resolve
        })
      }
      return undefined
    })
    renderDialog()
    await screen.findByText('settings.about.diagnostics.sources.logs.title')

    const exportButton = screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    fireEvent.click(exportButton)
    const confirmation = screen.getAllByRole('dialog').at(-1)!
    const consent = within(confirmation).getByRole('checkbox')
    const confirmButton = within(confirmation).getByRole('button', {
      name: 'settings.about.diagnostics.actions.export'
    })
    fireEvent.click(consent)
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.export')).toHaveLength(1)
    await act(async () => resolveExport({ status: 'canceled' }))
    await waitFor(() => expect(exportButton).toBeEnabled())

    fireEvent.click(exportButton)
    const nextConfirmation = screen.getAllByRole('dialog').at(-1)!
    expect(within(nextConfirmation).getByRole('checkbox')).not.toBeChecked()
    expect(
      within(nextConfirmation).getByRole('button', { name: 'settings.about.diagnostics.actions.export' })
    ).toBeDisabled()
  })

  it('falls back to copying the support email when no mail client can be opened', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') return savedResult
      if (route === 'system.shell.open_website') throw new Error('No mail client')
      return undefined
    })
    renderDialog()
    await screen.findByText('settings.about.diagnostics.sources.logs.title')
    await confirmSensitiveExport()
    await screen.findByText('settings.about.diagnostics.success.title')

    fireEvent.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.contact' }))
    const copyButton = await screen.findByRole('button', { name: 'settings.about.diagnostics.actions.copy_email' })
    expect(mocks.toastError).toHaveBeenCalledWith('settings.about.diagnostics.errors.email_client_failed')

    fireEvent.click(copyButton)
    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledWith('support@cherry-ai.com'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.about.diagnostics.success.email_copied')
  })
})
