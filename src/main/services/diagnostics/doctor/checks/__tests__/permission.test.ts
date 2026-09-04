import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const capture = vi.hoisted(() => ({
  getScreenCapturePermissionStatus: vi.fn(),
  requestScreenCapturePermission: vi.fn(),
  openScreenCaptureSettings: vi.fn()
}))
const accessibility = vi.hoisted(() => ({ isTrustedAccessibilityClient: vi.fn() }))

vi.mock('@main/core/platform', () => ({ isMac: true }))
vi.mock('@main/utils/screenCapturePermission', () => capture)
vi.mock('electron', () => ({ systemPreferences: accessibility }))

const { accessibilityPermission, screenCapturePermission } = await import('../permission')
const ctx = { signal: new AbortController().signal }

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  capture.getScreenCapturePermissionStatus.mockReturnValue('authorized')
  capture.requestScreenCapturePermission.mockResolvedValue('authorized')
  accessibility.isTrustedAccessibilityClient.mockReturnValue(true)
})

describe('permission-screen-capture', () => {
  it('passes until macOS has explicitly denied screen capture', async () => {
    capture.getScreenCapturePermissionStatus.mockReturnValue('not-determined')
    await expect(screenCapturePermission.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and offers a permission request when access is denied', async () => {
    capture.getScreenCapturePermissionStatus.mockReturnValue('denied')
    await expect(screenCapturePermission.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'denied' },
      actions: [{ kind: 'fix', fixId: 'request' }]
    })
  })

  it('opens System Settings when macOS will no longer show the permission prompt', async () => {
    capture.requestScreenCapturePermission.mockResolvedValue('denied')
    await expect(screenCapturePermission.fixes.request(ctx)).resolves.toEqual({ status: 'fixed' })
    expect(capture.openScreenCaptureSettings).toHaveBeenCalledOnce()
  })
})

describe('permission-accessibility', () => {
  it('passes without probing macOS when Selection Assistant is disabled', async () => {
    await expect(accessibilityPermission.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(accessibility.isTrustedAccessibilityClient).not.toHaveBeenCalled()
  })

  it('passes when Selection Assistant is enabled and trusted', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.selection.enabled', true)
    await expect(accessibilityPermission.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(accessibility.isTrustedAccessibilityClient).toHaveBeenCalledWith(false)
  })

  it('warns and offers a permission request when the enabled feature is not trusted', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.selection.enabled', true)
    accessibility.isTrustedAccessibilityClient.mockReturnValue(false)
    await expect(accessibilityPermission.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'denied' },
      actions: [{ kind: 'fix', fixId: 'request' }]
    })
  })

  it('requests trust from macOS when the fix runs', async () => {
    await expect(accessibilityPermission.fixes.request(ctx)).resolves.toEqual({ status: 'fixed' })
    expect(accessibility.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
  })
})
