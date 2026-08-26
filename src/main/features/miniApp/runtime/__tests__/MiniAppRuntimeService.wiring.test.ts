import { readFileSync } from 'node:fs'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MINI_APP_BRIDGE_CHANNEL } from '@shared/ipc/schemas/miniAppBridge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

// `BaseService` throws on the second `new` of the same class, so without this reset the
// file dies at case two — naming the singleton guard, not anything under test.
beforeEach(() => BaseService.resetInstances())

describe('MiniAppRuntimeService wiring', () => {
  it('wires every channel exactly once in a single onReady', async () => {
    // The bug this guards: a second `onReady` on the same class replaces the first.
    // Nothing throws — the bridge channel and the crash recovery simply never run.
    const svc = new MiniAppRuntimeService()
    const handled: string[] = []
    const listened: string[] = []
    vi.spyOn(svc as never, 'ipcHandle').mockImplementation(((c: string) => handled.push(c)) as never)
    vi.spyOn(svc as never, 'ipcOn').mockImplementation(((c: string) => listened.push(c)) as never)
    await (svc as unknown as { onReady: () => Promise<void> }).onReady()

    expect(handled).toEqual([MINI_APP_BRIDGE_CHANNEL])
    // No `ipcOn` at all now: the bridge is the only channel, and it is request/reply.
    // A listener appearing here means someone re-introduced an awaited event.
    expect(listened).toEqual([])
    expect(recoverInterruptedPublishes).toHaveBeenCalledTimes(1)
    expect(sweepAbandonedStaging).toHaveBeenCalledTimes(1)
  })

  it('declares exactly one onReady in the service source', () => {
    // A duplicate would silently win by source order; grep is the only check that
    // catches it, because TypeScript reports nothing for a re-declared method.
    const source = readFileSync(new URL('../MiniAppRuntimeService.ts', import.meta.url), 'utf8')
    expect(source.match(/protected async onReady/g)).toHaveLength(1)
  })

  it('pushes a locale change to every installed app', async () => {
    const svc = new MiniAppRuntimeService()
    vi.spyOn(svc as never, 'ipcHandle').mockImplementation((() => {}) as never)
    vi.spyOn(svc as never, 'ipcOn').mockImplementation((() => {}) as never)
    // `onReady` also broadcasts the attention state, which this stub cannot serve.
    // Unstubbed, the case fails inside a feature it is not testing.
    vi.spyOn(svc, 'broadcastAttentionState').mockImplementation(() => {})
    let onLanguage: ((locale: string | null) => void) | undefined
    vi.mocked(application.get).mockImplementation(((name: string) =>
      name === 'PreferenceService'
        ? { subscribeChange: (_k: string, fn: (l: string | null) => void) => ((onLanguage = fn), () => {}) }
        : {
            getDb: () => ({ select: () => ({ from: () => ({ all: () => [{ appId: 'com.example.a' }] }) }) })
          }) as never)

    await (svc as unknown as { onReady: () => Promise<void> }).onReady()
    // Passing null IS the test: an implementation that forwards the callback's own
    // argument pushes `locale: null` at the guest. Passing 'de-DE' would not catch it.
    onLanguage?.(null)

    const { emitToApp } = await import('../events')
    expect(emitToApp).toHaveBeenCalledWith('com.example.a', 'app.localeChange', { locale: 'de-DE' })
  })
})
