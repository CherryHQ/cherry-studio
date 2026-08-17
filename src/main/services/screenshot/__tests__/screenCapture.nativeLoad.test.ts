import { ScreenCaptureError } from '@main/services/screenshot/types'
import { describe, expect, it, vi } from 'vitest'

// Mock the loader, not the native package (see the sibling file), throwing what a real load failure
// throws. The factory is async because, being hoisted, it must not close over module-scope bindings.
vi.mock('@main/services/screenshot/nativeCaptureBackend', async () => {
  const { ScreenCaptureError: Err } = await import('@main/services/screenshot/types')
  return {
    loadNativeCaptureBackend: () => {
      throw new Err('Screen capture backend is unavailable', {
        cause: new Error('dlopen failed: wrong architecture')
      })
    }
  }
})
vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
  shell: { openExternal: vi.fn() }
}))
vi.mock('@main/core/platform', () => ({ isMac: true }))

describe('screenCapture native loading', () => {
  // The whole point of the lazy getter: the `system.*` permission routes pull this module in
  // through the barrel on every app start, capture feature enabled or not.
  it('imports cleanly even when the native backend cannot load', async () => {
    await expect(import('@main/services/screenshot/screenCapture')).resolves.toBeDefined()
  })

  it('surfaces a load failure as ScreenCaptureError at call time, not at import time', async () => {
    const { captureAllMonitors } = await import('@main/services/screenshot/screenCapture')
    await expect(captureAllMonitors()).rejects.toThrow(ScreenCaptureError)
  })

  it('still answers permission queries with the native backend broken', async () => {
    const { getScreenCapturePermissionStatus } = await import('@main/services/screenshot/screenCapture')
    expect(getScreenCapturePermissionStatus()).toBe('authorized')
  })
})
