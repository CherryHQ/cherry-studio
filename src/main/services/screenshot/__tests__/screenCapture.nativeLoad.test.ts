import { describe, expect, it, vi } from 'vitest'

import { ScreenCaptureError } from '@main/services/screenshot/types'

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
  // The lazy getter is what keeps a broken or absent native binary from taking the whole
  // module down at import time, which would break every consumer of the barrel.
  it('imports cleanly even when the native backend cannot load', async () => {
    await expect(import('@main/services/screenshot/screenCapture')).resolves.toBeDefined()
  })

  it('surfaces a load failure as ScreenCaptureError at call time, not at import time', async () => {
    const { captureAllMonitors } = await import('@main/services/screenshot/screenCapture')
    await expect(captureAllMonitors()).rejects.toThrow(ScreenCaptureError)
  })
})
