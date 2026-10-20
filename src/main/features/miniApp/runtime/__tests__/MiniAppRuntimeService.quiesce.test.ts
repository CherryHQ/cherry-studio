import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

vi.mock('../events', () => ({ emitToApp: vi.fn() }))

const destroy = vi.fn()
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: () => ({ destroy }) }
}))

// Must be the one the service actually calls: a bare `vi.fn()` never mounted on
// `@application` leaves every assertion below passing while measuring nothing.
const broadcast = vi.fn()
import { mockMiniAppApplication } from '../../__tests__/applicationMock'

vi.mock('@application', () => mockMiniAppApplication({ IpcApiService: { broadcast } }))

const { MiniAppQuiescingError, MiniAppRuntimeService } = await import('../MiniAppRuntimeService')

const A = 'com.example.a'

// `BaseService` throws on the second `new` of the same class, so without this reset the
// file dies at case two — naming the singleton guard, not anything under test.
beforeEach(() => BaseService.resetInstances())

describe('withAppQuiesced', () => {
  it('takes the app offline before its permissions change', async () => {
    // The bug this guards: granting inside the update transaction hands the new
    // permission to the OLD code, which the user never agreed to run with it.
    const order: string[] = []
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    // The pool unmounts in response to the broadcast; model that, rather than
    // unregistering up front — doing it up front would leave nothing to observe.
    vi.mocked(broadcast).mockImplementation(() => {
      order.push('evicted')
      svc.unregisterGuest(1)
    })

    await svc.withAppQuiesced(A, async () => void order.push('mutate'))

    expect(order).toEqual(['evicted', 'mutate'])
    expect(destroy).not.toHaveBeenCalled()
  })

  it('sends no suspend event before evicting', async () => {
    // The bug this guards: re-introducing a "last save chance". `app.suspend` is gone,
    // and emitting one rebuilds a promise the host cannot keep.
    const { emitToApp } = await import('../events')
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    vi.mocked(broadcast).mockImplementation(() => svc.unregisterGuest(1))

    await svc.withAppQuiesced(A, async () => 'done')

    expect(emitToApp).not.toHaveBeenCalled()
  })

  it('refuses a re-attach that arrives after eviction but before the mutation', async () => {
    // The bug this guards: waiting for zero guests and THEN mutating. The renderer can
    // call `prepare` in that gap and bring the old code back onto changing files.
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    vi.mocked(broadcast).mockImplementation(() => svc.unregisterGuest(1))

    let observed: boolean | undefined
    await svc.withAppQuiesced(A, async () => {
      observed = svc.isQuiescing(A)
    })

    expect(observed).toBe(true)
    expect(svc.isQuiescing(A)).toBe(false)
  })

  it('clears the quiescing mark even when the mutation throws', async () => {
    const svc = new MiniAppRuntimeService()
    await expect(
      svc.withAppQuiesced(A, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow()
    expect(svc.isQuiescing(A)).toBe(false)
  })

  it('destroys a guest that ignores the eviction rather than mutating around it', async () => {
    // The bug this guards: timing out and proceeding anyway. That is precisely the
    // state quiescing exists to prevent — old code, new grants, new files.
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    vi.mocked(broadcast).mockImplementation(() => {}) // pool never responds

    await expect(svc.withAppQuiesced(A, async () => 'done')).resolves.toBe('done')

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(svc.guestsOf(A)).toEqual([])
  })

  it('marks the app as quiescing before anything else, even with no guests', async () => {
    // The bug this guards: a "no guests → fast path". Deciding first and marking after
    // leaves a window for a fresh guest to attach onto new files.
    const svc = new MiniAppRuntimeService()
    let markedDuringMutation = false

    await svc.withAppQuiesced(A, async () => {
      markedDuringMutation = svc.isQuiescing(A)
    })

    expect(markedDuringMutation).toBe(true)
    expect(svc.isQuiescing(A)).toBe(false)
  })

  it('refuses a capability call that arrives after the mark', async () => {
    // The bug this guards: gating only the webview. A guest whose page is gone can still
    // have a bridge request land, and the request does not consult the webview at all.
    const svc = new MiniAppRuntimeService()
    let refused: unknown
    await svc.withAppQuiesced(A, async () => {
      try {
        svc.beginCapabilityCall(A)
      } catch (e) {
        refused = e
      }
    })
    expect(refused).toBeInstanceOf(MiniAppQuiescingError)
  })

  it('does NOT wait for a call that started before the mark', async () => {
    // Nobody waits on a mini app's in-flight work: queueing the user's uninstall behind
    // someone's `file.save` is the courtesy this model refuses.
    const svc = new MiniAppRuntimeService()
    svc.beginCapabilityCall(A) // admitted, never finishes

    await expect(svc.withAppQuiesced(A, async () => 'done')).resolves.toBe('done')
  })

  it('refuses the write of a call that straddles the mark', async () => {
    // This is what makes not-waiting safe: the call may still be running, but its
    // write is refused at the instant it happens.
    const svc = new MiniAppRuntimeService()
    const lease = svc.leaseFor(A)
    void svc.withAppQuiesced(A, async () => new Promise<void>(() => {})) // never settles
    await vi.waitFor(() => expect(svc.isQuiescing(A)).toBe(true))

    expect(() => svc.assertLeaseValid(lease)).toThrow(MiniAppQuiescingError)
  })

  it('still refuses a stale write AFTER the quiesce has finished', async () => {
    // Why a boolean mark is not enough: a `file.save` queued before a `clear_data` can
    // reach its write after it, when "is quiescing now?" is already FALSE.
    const svc = new MiniAppRuntimeService()
    const lease = svc.leaseFor(A)

    await svc.withAppQuiesced(A, async () => 'cleared')

    expect(svc.isQuiescing(A)).toBe(false) // window is over...
    expect(() => svc.assertLeaseValid(lease)).toThrow(MiniAppQuiescingError) // ...and it is STILL refused
  })

  it('lets a call that started after the quiesce write normally', async () => {
    // The mirror of the above: invalidation must be scoped to leases taken before,
    // not a permanent lockout of the app.
    const svc = new MiniAppRuntimeService()
    await svc.withAppQuiesced(A, async () => 'done')

    expect(() => svc.assertLeaseValid(svc.leaseFor(A))).not.toThrow()
  })

  it('invalidates leases even when the mutation throws', async () => {
    // A failed uninstall still destroyed the guest and may have moved files. Leases
    // from before it are just as stale as after a successful one.
    const svc = new MiniAppRuntimeService()
    const lease = svc.leaseFor(A)

    await expect(
      svc.withAppQuiesced(A, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow()

    expect(() => svc.assertLeaseValid(lease)).toThrow(MiniAppQuiescingError)
  })

  it('serializes two quiesces of the same app', async () => {
    // The bug this guards: overlapping windows. Whichever finishes first clears the
    // shared mark, and the second runs with the app declared "not quiescing".
    const svc = new MiniAppRuntimeService()
    const order: string[] = []
    const first = svc.withAppQuiesced(A, async () => {
      order.push('first-start')
      await Promise.resolve()
      expect(svc.isQuiescing(A)).toBe(true)
      order.push('first-end')
    })
    const second = svc.withAppQuiesced(A, async () => {
      expect(svc.isQuiescing(A)).toBe(true)
      order.push('second')
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('does not let a failed quiesce poison the queue', async () => {
    const svc = new MiniAppRuntimeService()
    await expect(
      svc.withAppQuiesced(A, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow()

    await expect(svc.withAppQuiesced(A, async () => 'ok')).resolves.toBe('ok')
  })

  it('does not serialize across different apps', async () => {
    const svc = new MiniAppRuntimeService()
    let releaseA: () => void = () => {}
    const a = svc.withAppQuiesced(A, () => new Promise<string>((r) => (releaseA = () => r('a'))))

    await expect(svc.withAppQuiesced('com.example.b', async () => 'b')).resolves.toBe('b')

    releaseA()
    await a
  })

  it('still refuses a pre-uninstall lease when the app had been quiesced exactly once before', async () => {
    // The bug this guards: `forgetApp` deleting the generation inside the uninstall's
    // quiesce, so the trailing bump lands on 1 — equal to a lease taken at generation 1.
    const svc = new MiniAppRuntimeService()
    await svc.withAppQuiesced(A, async () => 'first') // generation is now 1
    const lease = svc.leaseFor(A)

    await svc.withAppQuiesced(A, async () => svc.forgetApp(A))

    expect(() => svc.assertLeaseValid(lease)).toThrow(MiniAppQuiescingError)
  })
})
