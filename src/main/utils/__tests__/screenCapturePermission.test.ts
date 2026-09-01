import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMediaAccessStatus = vi.fn<() => string>()
const openExternal = vi.fn()

vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus },
  shell: { openExternal }
}))
vi.mock('@main/core/platform', () => ({ isMac: true }))

const { getScreenCapturePermissionStatus, openScreenCaptureSettings } =
  await import('@main/utils/screenCapturePermission')

describe('screen capture permission', () => {
  beforeEach(() => {
    getMediaAccessStatus.mockReset()
    openExternal.mockClear()
  })

  // 'restricted' is the MDM case: the user cannot grant it, so folding it into anything
  // other than 'denied' would send them to a System Settings toggle they cannot flip.
  it('maps the Electron media-access status onto the permission tri-state', () => {
    getMediaAccessStatus.mockReturnValue('not-determined')
    expect(getScreenCapturePermissionStatus()).toBe('not-determined')
    getMediaAccessStatus.mockReturnValue('granted')
    expect(getScreenCapturePermissionStatus()).toBe('authorized')
    getMediaAccessStatus.mockReturnValue('restricted')
    expect(getScreenCapturePermissionStatus()).toBe('denied')
  })

  // The scheme is not in ALLOWED_EXTERNAL_PROTOCOLS, so routing this through the
  // vetted `system.shell.open_website` path would drop it silently.
  it('opens the Screen Recording pane directly rather than through the vetted URL route', () => {
    openScreenCaptureSettings()

    expect(openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })
})
