import { MockUseDataApiUtils, mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

// The composition-root case renders the WHOLE useWindowRuntime, whose attention sync
// hits `@renderer/ipc` — same minimal mock the attention test file uses.
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn(async () => []) },
  useIpcOn: () => {}
}))

const { useMiniAppListSync } = await import('../useMiniApps')
const { useWindowRuntime } = await import('../useWindowRuntime')

// Pinned across renders, as in `useTasks.test.ts` — the factory default mints a fresh
// fn per call and the assertion would interrogate an abandoned spy.
const invalidateSpy = vi.fn(async () => {})

beforeEach(() => {
  // `useWindowRuntime` paints the root background; jsdom has no `#root` element.
  window.root = document.createElement('div')
  MockUseDataApiUtils.resetMocks()
  mockUseInvalidateCache.mockReturnValue(invalidateSpy)
  invalidateSpy.mockClear()
})

it('refetches the launcher list when an IPC-side write publishes a change', () => {
  renderHook(() => useMiniAppListSync())

  MockUseDataApiUtils.emitDataChange([{ endpoint: '/mini-apps', kind: 'membership' }])

  expect(invalidateSpy).toHaveBeenCalledWith('/mini-apps')
})

it('leaves the launcher list alone when some other endpoint changes', () => {
  // The negative control: a subscription written wider than `/mini-apps` refetches the
  // launcher on every unrelated write, and the case above cannot tell.
  renderHook(() => useMiniAppListSync())

  MockUseDataApiUtils.emitDataChange([{ endpoint: '/assistants', kind: 'membership' }])

  expect(invalidateSpy).not.toHaveBeenCalled()
})

it('is actually mounted by useWindowRuntime', () => {
  // The case above renders the hook LOCALLY, so it stays green even if production
  // never mounts it. This is the one that touches the real composition.
  renderHook(() => useWindowRuntime())

  MockUseDataApiUtils.emitDataChange([{ endpoint: '/mini-apps', kind: 'projection' }])

  expect(invalidateSpy).toHaveBeenCalledWith('/mini-apps')
})
