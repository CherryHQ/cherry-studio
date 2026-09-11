import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn()
}))

vi.unmock('@cherrystudio/ui')

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
    chatRecords: { available: true, estimatedBytes: 1_024, messageCount: 1 },
    crashDumps: { fileCount: 0 },
    logs: { available: true, estimatedBytes: 1_024, fileCount: 1 },
    traces: { available: false, estimatedBytes: 0, fileCount: 0 }
  }
}

const savedResult: Extract<OutputFor<'diagnostics.bundle.export'>, { status: 'saved' }> = {
  archiveBytes: 1_024,
  bundleId: 'bundle-123',
  fileName: 'diagnostics.zip',
  filePath: AbsoluteFilePathSchema.parse('/tmp/diagnostics.zip'),
  hasWarnings: false,
  includedFileCount: 1,
  omittedFileCount: 0,
  status: 'saved'
}

function installExitAnimationStyle() {
  const originalGetComputedStyle = window.getComputedStyle
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const styles = originalGetComputedStyle(element)
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'animationName') {
          return element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter'
        }
        if (property === 'display') return 'grid'
        return Reflect.get(target, property, receiver)
      }
    })
  })
}

async function confirmExport(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'settings.about.diagnostics.actions.export' }))
  const confirmation = screen
    .getAllByRole('dialog')
    .find((dialog) => within(dialog).queryByText('settings.about.diagnostics.privacy.title'))!
  await user.click(within(confirmation).getByRole('checkbox'))
  await user.click(within(confirmation).getByRole('button', { name: 'settings.about.diagnostics.actions.export' }))
}

describe('DiagnosticBundleDialog close transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('electron', { process: { platform: 'darwin' } })
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'diagnostics.bundle.inspect') return inspectResult
      if (route === 'diagnostics.bundle.export') return savedResult
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for the consent dialog to close before starting the export', async () => {
    installExitAnimationStyle()
    const user = userEvent.setup()
    render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={vi.fn()} />)

    await confirmExport(user)

    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.export')).toHaveLength(0)
    await waitFor(() =>
      expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.bundle.export')).toHaveLength(1)
    )
  })

  it('keeps the saved result visible throughout the outer dialog close animation', async () => {
    installExitAnimationStyle()
    const user = userEvent.setup()
    const { rerender } = render(<DiagnosticBundleDialog appVersion="2.0.0" open onOpenChange={vi.fn()} />)
    await confirmExport(user)
    expect(await screen.findByText('settings.about.diagnostics.success.title')).toBeInTheDocument()

    rerender(<DiagnosticBundleDialog appVersion="2.0.0" open={false} onOpenChange={vi.fn()} />)

    expect(screen.getByText('settings.about.diagnostics.success.title')).toBeInTheDocument()
    expect(screen.queryByText('settings.about.diagnostics.range_title')).not.toBeInTheDocument()
  })
})
