import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MINI_APP_BRIDGE_CHANNEL } from '@shared/ipc/schemas/miniAppBridge'

import { sweepAbandonedStaging } from '../../install/installer'
import { recoverInterruptedPublishes } from '../../install/publishJournal'

// Resolution itself is `@main/i18n`'s own contract and is tested there. What this file
// owns is whether a language change REACHES every installed app.
vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'de-DE' }))
vi.mock('../../install/publishJournal', () => ({ recoverInterruptedPublishes: vi.fn().mockResolvedValue([]) }))
vi.mock('../../install/installer', () => ({
  sweepAbandonedStaging: vi.fn().mockResolvedValue(0),
  miniAppInstallPath: vi.fn()
}))
vi.mock('../bridge', () => ({ handleBridgeRequest: vi.fn() }))
vi.mock('../events', () => ({ emitToApp: vi.fn() }))

const { MiniAppRuntimeService } = await import('../MiniAppRuntimeService')

type WiringMethods = {
  ipcHandle: InstanceType<typeof MiniAppRuntimeService>['ipcHandle']
  ipcOn: InstanceType<typeof MiniAppRuntimeService>['ipcOn']
  onReady: InstanceType<typeof MiniAppRuntimeService>['onReady']
  installedAppIds: InstanceType<typeof MiniAppRuntimeService>['installedAppIds']
}

type WiringService = Omit<InstanceType<typeof MiniAppRuntimeService>, keyof WiringMethods> & WiringMethods

function wiringService(): WiringService {
  // SAFETY: Only method visibility changes for source-typed spies; the service instance and public surface stay intact.
  const service = new MiniAppRuntimeService() as WiringService
  vi.spyOn(service, 'broadcastAttentionState').mockReturnValue(undefined)
  return service
}

// `BaseService` throws on the second `new` of the same class, so without this reset the
// file dies at case two — naming the singleton guard, not anything under test.
beforeEach(() => BaseService.resetInstances())

describe('MiniAppRuntimeService wiring', () => {
  it('wires every channel exactly once in a single onReady', async () => {
    // The bug this guards: a second `onReady` on the same class replaces the first.
    // Nothing throws — the bridge channel and the crash recovery simply never run.
    const svc = wiringService()
    const handled: string[] = []
    const listened: string[] = []
    vi.spyOn(svc, 'ipcHandle').mockImplementation((c: string) => {
      handled.push(c)
      return { dispose() {} }
    })
    vi.spyOn(svc, 'ipcOn').mockImplementation((c: string) => {
      listened.push(c)
      return { dispose() {} }
    })
    await svc.onReady()

    expect(handled).toEqual([MINI_APP_BRIDGE_CHANNEL])
    // No `ipcOn` at all now: the bridge is the only channel, and it is request/reply.
    // A listener appearing here means someone re-introduced an awaited event.
    expect(listened).toEqual([])
    expect(recoverInterruptedPublishes).toHaveBeenCalledTimes(1)
    expect(sweepAbandonedStaging).toHaveBeenCalledTimes(1)
  })

  it('carries the apps recovery could not repair through the barrier', async () => {
    // The fail-open this closes: recovery reports a per-entry failure and moves on, so a
    // barrier that resolved with nothing would readmit an app whose tree the rows no
    // longer describe. The repaired one must NOT be carried — it would never open again.
    vi.mocked(recoverInterruptedPublishes).mockResolvedValueOnce([
      { appId: 'com.example.broken', action: 'failed' },
      { appId: 'com.example.ok', action: 'rolled-back' }
    ])
    const svc = wiringService()
    vi.spyOn(svc, 'ipcHandle').mockImplementation(() => ({ dispose() {} }))
    vi.spyOn(svc, 'ipcOn').mockImplementation(() => ({ dispose() {} }))

    await svc.onReady()

    expect(await svc.recovered).toEqual(new Set(['com.example.broken']))
  })

  it('pushes a locale change to every installed app', async () => {
    const svc = wiringService()
    vi.spyOn(svc, 'ipcHandle').mockImplementation(() => ({ dispose() {} }))
    vi.spyOn(svc, 'ipcOn').mockImplementation(() => ({ dispose() {} }))
    vi.spyOn(svc, 'installedAppIds').mockReturnValue(['com.example.a', 'com.example.b'])
    const subscribe = vi.mocked(application.get('PreferenceService').subscribeChange<'app.language'>)
    let onLanguage: Parameters<typeof subscribe>[1] | undefined
    subscribe.mockImplementation((key, listener) => {
      expect(key).toBe('app.language')
      onLanguage = listener
      return () => {}
    })

    await svc.onReady()
    // Passing null IS the test: an implementation that forwards the callback's own
    // argument pushes `locale: null` at the guest. Passing 'de-DE' would not catch it.
    onLanguage?.(null)

    const { emitToApp } = await import('../events')
    expect(emitToApp).toHaveBeenCalledTimes(2)
    expect(emitToApp).toHaveBeenCalledWith('com.example.a', 'app.localeChange', { locale: 'de-DE' })
    expect(emitToApp).toHaveBeenCalledWith('com.example.b', 'app.localeChange', { locale: 'de-DE' })
  })
})
