import { vi } from 'vitest'

/**
 * Mock of the `services/toast` module. `toast` is the ToastUtilities object whose
 * methods are spies, so tests can assert on `toast.error(...)` / `toast.success(...)`
 * without a real viewport. Globally installed in tests/renderer.setup.ts; import
 * `{ toast }` from '@renderer/services/toast' in a test to assert on it, and call
 * `resetToastMocks()` in a beforeEach if needed.
 */
export const mockToast = {
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  closeToast: vi.fn(),
  closeAll: vi.fn(),
  getToastQueue: vi.fn(() => ({ toasts: [] }))
}

export const MockToast = {
  toast: mockToast
}

export const resetToastMocks = () => {
  for (const fn of Object.values(mockToast)) {
    fn.mockClear()
  }
}
