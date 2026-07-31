import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const ipc = vi.hoisted(() => ({
  // Typed with a route argument so `mock.calls` can be filtered by route below.
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => []),
  handlers: new Map<string, (payload: unknown) => void>()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipc.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    ipc.handlers.set(event, handler)
  }
}))
// The global `useCache` stand-in reads its OWN map, which `cacheService.setShared` never
// writes — the reader must watch the same store the writer writes, as in production.
vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
const request = ipc.request

const { useMiniAppAttention, useMiniAppAttentionSync } = await import('../useMiniAppAttention')
/** One reason is enough to be listed; which one is the tile's business. */
const lit = (appId: string) => ({ appId, updateVersion: '1.1.0', pendingPermissions: [], updating: null })
const { useWindowRuntime } = await import('../useWindowRuntime')

// Neither `clearMocks` nor `restoreMocks` is set repo-wide, and the "pulls exactly
// once" assertion counts TOTAL calls — without this it measures the cases before it.
beforeEach(() => {
  // `useWindowRuntime` paints the root background; jsdom has no `#root` element.
  window.root = document.createElement('div')
  // `mockReset()`, not `mockClear()`: clear leaves the implementation, so the late-pull
  // case's never-resolving promise would leak into the next one.
  ipc.request.mockReset()
  ipc.handlers.clear()
  cacheService.deleteShared('mini_app.attention')
})

// The writer and a reader, isolated from the rest of `useWindowRuntime`.
const Owner = () => {
  useMiniAppAttentionSync() // the effect pair extracted from useWindowRuntime
  return <Reader />
}
const Reader = () => (
  <>
    {useMiniAppAttention().map(({ appId }) => (
      <span key={appId} data-testid={`badge-${appId}`} />
    ))}
  </>
)

it('paints the badge on a window that opened after the startup broadcast', async () => {
  // The bug this guards: subscribing without pulling. Such a window sees no event
  // until the next grant or check, so its first paint is silently wrong.
  request.mockResolvedValue([lit('com.example.mygame')])

  render(<Owner />)

  expect(await screen.findByTestId('badge-com.example.mygame')).toBeInTheDocument()
})

it('pulls once no matter how many list items read the badge', async () => {
  // The bug this guards: putting the fetch in `useMiniApps` (23 consumer files).
  // Every mounted consumer would issue its own request and its own subscription.
  render(
    <>
      <Owner />
      <Reader />
      <Reader />
      <Reader />
    </>
  )
  await waitFor(() => expect(request).toHaveBeenCalled())

  expect(request.mock.calls.filter(([route]) => route === 'mini_app.runtime.attention_state')).toHaveLength(1)
})

it('does not let a late pull overwrite an event that already arrived', async () => {
  // The race this guards: pull resolves AFTER a broadcast. Applying it then rolls the
  // badge back to the pre-grant list, and nothing corrects it until the next broadcast.
  let resolvePull: (apps: ReturnType<typeof lit>[]) => void = () => {}
  request.mockImplementation(
    () =>
      new Promise<ReturnType<typeof lit>[]>((r) => {
        resolvePull = r
      })
  )
  render(<Owner />)

  act(() => ipc.handlers.get('mini_app.runtime.attention')!({ apps: [lit('com.example.b')] }))
  await act(async () => resolvePull([lit('com.example.a')]))
  await waitFor(() => expect(screen.getByTestId('badge-com.example.b')).toBeInTheDocument())

  expect(screen.queryByTestId('badge-com.example.a')).toBeNull()
})

it('puts a lit badge out when the host broadcasts an empty set', async () => {
  // The bug this guards: treating `[]` as "nothing to say" — the badge would then
  // survive the very grant that cleared it, until some other app lit up.
  request.mockResolvedValue([lit('com.example.a')])
  render(<Owner />)
  await screen.findByTestId('badge-com.example.a')

  act(() => ipc.handlers.get('mini_app.runtime.attention')!({ apps: [] }))

  expect(screen.queryByTestId('badge-com.example.a')).toBeNull()
})

it('is actually mounted by useWindowRuntime', () => {
  // The cases above render a LOCAL `Owner`, so they stay green even if production never
  // calls the sync hook. This is the only one that touches the real composition.
  renderHook(() => useWindowRuntime())

  expect(request).toHaveBeenCalledWith('mini_app.runtime.attention_state')
})
