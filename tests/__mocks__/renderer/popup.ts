import { vi } from 'vitest'

/**
 * Mock of the `services/popup` module. The confirm-family prefabs default to the
 * "user confirmed" outcome — they invoke the passed `onOk` and resolve `true`. Tests
 * that exercise the cancel path override per case (e.g.
 * `vi.mocked(confirm).mockResolvedValueOnce(false)` or a custom implementation).
 * `createPopup(...).show()` resolves `undefined` by default.
 *
 * Globally installed in tests/renderer.setup.ts. Import the prefabs from
 * '@renderer/services/popup' to assert on them; call `resetPopupMocks()` in a
 * beforeEach to restore defaults. Tests that need the REAL implementation (the
 * popup-infra unit tests) opt out with `vi.mock('@renderer/services/popup', async
 * (importOriginal) => await importOriginal())`.
 */
type ConfirmProps = { onOk?: () => unknown | Promise<unknown>; onCancel?: () => unknown | Promise<unknown> }

const makePrefab = () =>
  vi.fn(async (props?: ConfirmProps) => {
    await props?.onOk?.()
    return true
  })

export const mockConfirm = makePrefab()
export const mockError = makePrefab()
export const mockInfo = makePrefab()
export const mockWarning = makePrefab()

export const mockPopupService = {
  subscribe: vi.fn(() => () => {}),
  getSnapshot: vi.fn(() => []),
  settle: vi.fn(),
  showComponent: vi.fn(),
  showConfirm: vi.fn(async () => true),
  generateInstanceId: vi.fn(() => 'popup-mock')
}

export const mockCreatePopup = vi.fn(() => ({
  show: vi.fn(async () => undefined),
  hide: vi.fn()
}))

export const MockPopup = {
  popup: { confirm: mockConfirm, error: mockError, info: mockInfo, warning: mockWarning },
  createPopup: mockCreatePopup,
  popupService: mockPopupService,
  POPUP_EXIT_MS: 200
}

export const resetPopupMocks = () => {
  for (const fn of [mockConfirm, mockError, mockInfo, mockWarning]) {
    fn.mockClear()
    fn.mockImplementation(async (props?: ConfirmProps) => {
      await props?.onOk?.()
      return true
    })
  }
  mockCreatePopup.mockClear()
  for (const fn of Object.values(mockPopupService)) {
    fn.mockClear()
  }
}
