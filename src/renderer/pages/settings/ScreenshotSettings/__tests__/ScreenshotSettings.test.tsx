import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScreenshotSettings from '../ScreenshotSettings'

type ScreenCaptureStatus = 'authorized' | 'not-determined' | 'denied'

type ConflictListener = (payload: { key: string; hasConflict: boolean }) => void
let conflictListener: ConflictListener | null = null
type LocalModelProgressListener = (payload: { model: 'ocr'; status: 'downloading' | 'ready'; percent: number }) => void
let localModelProgressListener: LocalModelProgressListener | null = null

const { mockRequest, platform } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  platform: { isMac: true }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mockRequest(...args) },
  useIpcOn: (event: string, listener: LocalModelProgressListener) => {
    if (event === 'local_model.download_progress') localModelProgressListener = listener
  }
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  },
  isWin: false,
  isLinux: false
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return MockCherrystudioUI
})

interface IpcStub {
  /** Status the page reads on mount. */
  permission?: ScreenCaptureStatus
  /** Status the OS reports back after prompting. */
  afterRequest?: ScreenCaptureStatus
  ocrStatus?: string
  defaultOcrProcessorId?: FileProcessorId
  processorResolutionError?: Error
}

function stubIpc({
  permission = 'authorized',
  afterRequest = 'authorized',
  ocrStatus = 'not_downloaded',
  defaultOcrProcessorId,
  processorResolutionError
}: IpcStub) {
  mockRequest.mockImplementation((route: string) => {
    switch (route) {
      case 'system.mac.screen_capture_status':
        return Promise.resolve(permission)
      case 'system.mac.request_screen_capture':
        return Promise.resolve(afterRequest)
      case 'local_model.get_status':
        return Promise.resolve({ status: ocrStatus })
      case 'file_processing.configured_processor.get':
        return processorResolutionError
          ? Promise.reject(processorResolutionError)
          : Promise.resolve(
              defaultOcrProcessorId ??
                MockUsePreferenceUtils.getPreferenceValue('feature.file_processing.default_image_to_text') ??
                'system'
            )
      default:
        return Promise.resolve()
    }
  })
}

const requestedRoutes = () => mockRequest.mock.calls.map((call) => call[0] as string)

const screenshotEnabledSwitchName = /^settings\.screenshot\.enable\.title\b/
const autoOcrSwitchName = /^settings\.screenshot\.ocr\.auto\.title\b/
const autoOcrSwitch = () => screen.getByRole('switch', { name: autoOcrSwitchName })

describe('ScreenshotSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.screenshot.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('feature.screenshot.auto_ocr', true)
    MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', 'local-paddleocr')
    MockUsePreferenceUtils.setPreferenceValue('shortcut.screenshot.capture', {
      binding: ['CommandOrControl', 'Shift', 'A'],
      enabled: true
    })
    platform.isMac = true

    // The row subscribes on mount; tests that need a conflict call the captured listener.
    conflictListener = null
    localModelProgressListener = null
    window.api = {
      shortcut: {
        onRegistrationConflict: (callback: ConflictListener) => {
          conflictListener = callback
          return () => {
            conflictListener = null
          }
        }
      }
    } as unknown as typeof window.api
  })

  it('keeps the auto-OCR switch inoperable until the OCR model is ready', async () => {
    stubIpc({ ocrStatus: 'not_downloaded' })
    const { unmount } = render(<ScreenshotSettings />)

    // Turning auto-OCR on without the model would promise recognition that silently never runs.
    await waitFor(() => expect(autoOcrSwitch()).toBeDisabled())
    expect(screen.getByText('settings.screenshot.ocr.model.unavailable')).toBeInTheDocument()
    unmount()

    stubIpc({ ocrStatus: 'ready' })
    render(<ScreenshotSettings />)

    await waitFor(() => expect(autoOcrSwitch()).toBeEnabled())
    expect(screen.getByText('settings.screenshot.ocr.model.ready')).toBeInTheDocument()
  })

  it('recovers when the selected local OCR model becomes ready without a preference change', async () => {
    stubIpc({ ocrStatus: 'downloading' })
    render(<ScreenshotSettings />)

    await waitFor(() => expect(autoOcrSwitch()).toBeDisabled())
    expect(screen.getByText('settings.screenshot.ocr.model.downloading')).toBeInTheDocument()

    act(() => localModelProgressListener?.({ model: 'ocr', status: 'ready', percent: 100 }))

    await waitFor(() => expect(autoOcrSwitch()).toBeEnabled())
    expect(screen.getByText('settings.screenshot.ocr.model.ready')).toBeInTheDocument()
  })

  it.each(['system', 'tesseract', 'mistral'] as const)(
    'disables screenshot text overlay for configured %s because it has no word geometry',
    async (processorId) => {
      MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', processorId)
      stubIpc({ ocrStatus: 'not_downloaded' })

      render(<ScreenshotSettings />)

      await waitFor(() => expect(autoOcrSwitch()).toBeDisabled())
      expect(screen.getByText('settings.screenshot.ocr.model.unavailable')).toBeInTheDocument()
    }
  )

  it('uses the effective default processor when the preference is unset', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', null)
    stubIpc({ defaultOcrProcessorId: 'system', ocrStatus: 'not_downloaded' })

    render(<ScreenshotSettings />)

    await waitFor(() => expect(autoOcrSwitch()).toBeDisabled())
    expect(requestedRoutes()).toContain('file_processing.configured_processor.get')
    expect(screen.getByText('settings.screenshot.ocr.model.unavailable')).toBeInTheDocument()
  })

  it('keeps auto OCR disabled when main rejects the configured processor capability', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', 'local-document')
    stubIpc({ processorResolutionError: new Error('processor does not support image_to_text') })

    render(<ScreenshotSettings />)

    await waitFor(() => expect(autoOcrSwitch()).toBeDisabled())
    expect(requestedRoutes()).toContain('file_processing.configured_processor.get')
    expect(screen.getByText('settings.screenshot.ocr.model.unavailable')).toBeInTheDocument()
  })

  it('offers System Settings rather than an authorize button once the permission is denied', async () => {
    stubIpc({ permission: 'denied' })
    render(<ScreenshotSettings />)

    expect(await screen.findByText('settings.screenshot.permission.open_settings')).toBeInTheDocument()
    // Prompting again is a no-op after a denial — the OS asks at most once.
    expect(screen.queryByText('settings.screenshot.permission.grant')).not.toBeInTheDocument()
    expect(screen.getByText('settings.screenshot.permission.denied_hint')).toBeInTheDocument()
  })

  // Without this the row only offers a link, so the one question it exists to answer —
  // "which key fires a capture, and is it even on?" — costs a trip to another page.
  it('shows the bound capture shortcut instead of only linking away', async () => {
    stubIpc({ permission: 'authorized' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })

    // macOS renders the accelerator as symbols; the mocked binding is CommandOrControl+Shift+A.
    expect(screen.getByText('⌘⇧A')).toBeInTheDocument()
    expect(screen.queryByText('settings.screenshot.shortcut.unset')).not.toBeInTheDocument()
  })

  // A bound-but-disabled shortcut is the confusing case: the key is shown, so the row looks
  // like it works. Encoding that only in the badge's fill would leave it unreadable.
  it('spells out that a bound shortcut is switched off', async () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.screenshot.capture', {
      binding: ['CommandOrControl', 'Shift', 'A'],
      enabled: false
    })
    stubIpc({ permission: 'authorized' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })

    expect(screen.getByText('⌘⇧A')).toBeInTheDocument()
    expect(screen.getByText('settings.screenshot.shortcut.disabled')).toBeInTheDocument()
  })

  it('flags a shortcut the OS refused to register, which the badge alone would hide', async () => {
    stubIpc({ permission: 'authorized' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })
    expect(screen.queryByLabelText('settings.shortcuts.occupied_by_other_application')).not.toBeInTheDocument()

    // Another application already owns the accelerator. The binding is still displayed,
    // so without this the row claims a working shortcut that in fact does nothing.
    act(() => conflictListener?.({ key: 'shortcut.screenshot.capture', hasConflict: true }))
    expect(screen.getByLabelText('settings.shortcuts.occupied_by_other_application')).toBeInTheDocument()

    act(() => conflictListener?.({ key: 'shortcut.screenshot.capture', hasConflict: false }))
    expect(screen.queryByLabelText('settings.shortcuts.occupied_by_other_application')).not.toBeInTheDocument()
  })

  it('ignores a conflict reported for a different shortcut', async () => {
    stubIpc({ permission: 'authorized' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })
    act(() => conflictListener?.({ key: 'shortcut.app.search', hasConflict: true }))

    expect(screen.queryByLabelText('settings.shortcuts.occupied_by_other_application')).not.toBeInTheDocument()
  })

  it('says the shortcut is unset rather than showing an empty badge', async () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.screenshot.capture', { binding: [], enabled: false })
    stubIpc({ permission: 'authorized' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })

    expect(screen.getByText('settings.screenshot.shortcut.unset')).toBeInTheDocument()
  })

  it('renders no permission section off macOS', async () => {
    platform.isMac = false
    stubIpc({ permission: 'denied' })
    render(<ScreenshotSettings />)

    await screen.findByRole('switch', { name: screenshotEnabledSwitchName })

    expect(screen.queryByText('settings.screenshot.permission.title')).not.toBeInTheDocument()
    expect(requestedRoutes()).not.toContain('system.mac.screen_capture_status')
  })

  it('renders no permission section on macOS once the permission is already granted', async () => {
    stubIpc({ permission: 'authorized', ocrStatus: 'ready' })
    render(<ScreenshotSettings />)

    // The OCR badge settles strictly after the permission status does, so an absent
    // section here is a verdict on 'authorized' rather than on a status not yet read.
    expect(await screen.findByText('settings.screenshot.ocr.model.ready')).toBeInTheDocument()
    expect(screen.queryByText('settings.screenshot.permission.title')).not.toBeInTheDocument()
  })

  it('moves into the restart state when the OS grants the permission', async () => {
    const user = userEvent.setup()
    stubIpc({ permission: 'not-determined', afterRequest: 'authorized' })
    render(<ScreenshotSettings />)

    await user.click(await screen.findByText('settings.screenshot.permission.grant'))

    // A fresh grant only takes effect in a new process, so the page must say so and offer the restart.
    expect(await screen.findByText('settings.screenshot.permission.restart_hint')).toBeInTheDocument()
    const restart = screen.getByText('settings.screenshot.permission.restart')
    expect(screen.queryByText('settings.screenshot.permission.grant')).not.toBeInTheDocument()

    await user.click(restart)
    await waitFor(() => expect(requestedRoutes()).toContain('app.relaunch'))
  })

  it('moves into the System Settings guidance when the OS denies the permission', async () => {
    const user = userEvent.setup()
    stubIpc({ permission: 'not-determined', afterRequest: 'denied' })
    render(<ScreenshotSettings />)

    await user.click(await screen.findByText('settings.screenshot.permission.grant'))

    expect(await screen.findByText('settings.screenshot.permission.denied_hint')).toBeInTheDocument()
    expect(screen.getByText('settings.screenshot.permission.open_settings')).toBeInTheDocument()
    expect(screen.queryByText('settings.screenshot.permission.grant')).not.toBeInTheDocument()
  })

  it('falls back to System Settings when the system prompt never appears', async () => {
    const user = userEvent.setup()
    stubIpc({ permission: 'not-determined', afterRequest: 'not-determined' })
    render(<ScreenshotSettings />)

    await user.click(await screen.findByText('settings.screenshot.permission.grant'))

    // An unsigned dev binary gets no dialog; re-offering "grant" would loop the user forever.
    expect(await screen.findByText('settings.screenshot.permission.prompt_unavailable_hint')).toBeInTheDocument()
    expect(screen.getByText('settings.screenshot.permission.open_settings')).toBeInTheDocument()
    expect(screen.queryByText('settings.screenshot.permission.grant')).not.toBeInTheDocument()
  })

  it('opens the settings pane through the dedicated route, not the URL allowlist', async () => {
    const user = userEvent.setup()
    stubIpc({ permission: 'denied' })
    render(<ScreenshotSettings />)

    await user.click(await screen.findByText('settings.screenshot.permission.open_settings'))

    // `system.shell.open_website` screens URL schemes and would silently drop
    // `x-apple.systempreferences:`, leaving the button dead.
    await waitFor(() => expect(requestedRoutes()).toContain('system.mac.open_screen_capture_settings'))
    expect(requestedRoutes()).not.toContain('system.shell.open_website')
  })
})
