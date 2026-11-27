import { setImmediate as nextImmediate } from 'node:timers/promises'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService, LifecycleManager, ServiceContainer } from '@main/core/lifecycle'

import { Application } from '../Application'

vi.unmock('@application')

function resetApplication() {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

describe('Application quit guards', () => {
  let application: Application
  let beforeQuit: (event: Event) => void
  let acceptedExits: number

  const requestNativeQuit = () => {
    const event = new Event('before-quit', { cancelable: true })
    beforeQuit(event)
    if (!event.defaultPrevented) acceptedExits++
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetApplication()
    acceptedExits = 0
    Object.assign(app, {
      on: vi.fn((event: string, listener: (event: Event) => void) => {
        if (event === 'before-quit') beforeQuit = listener
      }),
      quit: vi.fn(requestNativeQuit)
    })
    application = Application.getInstance()
    application['setupQuitHandlers']()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetApplication()
  })

  it('exits synchronously without guards or domain services', () => {
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
    expect(application.isQuitting).toBe(true)
  })

  it('exits synchronously when every guard allows it', () => {
    application.registerQuitGuard(() => true)
    application.registerQuitGuard(() => true)
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('blocks a synchronous veto and allows quitting after the guard is disposed', () => {
    const hold = application.registerQuitGuard(() => false)
    requestNativeQuit()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    hold.dispose()
    hold.dispose()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('waits for guards in order and stops at the first veto', async () => {
    const first = Promise.withResolvers<boolean>()
    const second = Promise.withResolvers<boolean>()
    const visited: string[] = []
    application.registerQuitGuard(() => {
      visited.push('first')
      return first.promise
    })
    application.registerQuitGuard(() => {
      visited.push('second')
      return second.promise
    })
    application.registerQuitGuard(() => {
      visited.push('third')
      return true
    })
    requestNativeQuit()
    expect(visited).toEqual(['first'])
    first.resolve(true)
    await nextImmediate()
    expect(visited).toEqual(['first', 'second'])
    expect(acceptedExits).toBe(0)
    second.resolve(false)
    await nextImmediate()
    expect(visited).toEqual(['first', 'second'])
    expect(acceptedExits).toBe(0)
  })

  it('coalesces repeated requests and resumes quitting once all guards approve', async () => {
    const decision = Promise.withResolvers<boolean>()
    let evaluations = 0
    application.registerQuitGuard(() => {
      evaluations++
      return decision.promise
    })
    requestNativeQuit()
    application.quit()
    requestNativeQuit()
    expect(acceptedExits).toBe(0)
    decision.resolve(true)
    await nextImmediate()
    expect(evaluations).toBe(1)
    expect(acceptedExits).toBe(1)
    expect(application.isQuitting).toBe(true)
  })

  it.each(['throw', 'reject', 'veto'] as const)('allows a retry after a guard %s', async (failure) => {
    let attempts = 0
    application.registerQuitGuard(() => {
      if (++attempts > 1) return true
      if (failure === 'throw') throw new Error('guard failed')
      if (failure === 'reject') return Promise.reject(new Error('guard failed'))
      return Promise.resolve(false)
    })
    requestNativeQuit()
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('checks hard holds before consulting guards', () => {
    let evaluations = 0
    application.registerQuitGuard(() => {
      evaluations++
      return true
    })
    const hold = application.preventQuit('critical write')
    requestNativeQuit()
    expect(acceptedExits).toBe(0)
    expect(evaluations).toBe(0)
    hold.dispose()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('ignores pending approval from a disposed guard', async () => {
    const decision = Promise.withResolvers<boolean>()
    const registration = application.registerQuitGuard(() => decision.promise)
    requestNativeQuit()
    registration.dispose()
    decision.resolve(true)
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('rechecks hard holds after asynchronous approval and discards that approval when blocked', async () => {
    const decision = Promise.withResolvers<boolean>()
    let attempts = 0
    application.registerQuitGuard(() => (++attempts === 1 ? decision.promise : false))
    requestNativeQuit()
    const hold = application.preventQuit('critical write')
    decision.resolve(true)
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    hold.dispose()
    requestNativeQuit()
    expect(attempts).toBe(2)
    expect(acceptedExits).toBe(0)
  })

  it.each(['system-shutdown', 'updater'] as const)('skips guards for %s but retains hard holds', (source) => {
    application.registerQuitGuard(() => false)
    const hold = application.preventQuit('critical write')
    const quit = () => {
      if (source === 'system-shutdown') application.quit(source)
      else {
        application.markQuitting()
        requestNativeQuit()
      }
    }
    quit()
    expect(acceptedExits).toBe(0)
    hold.dispose()
    quit()
    expect(acceptedExits).toBe(1)
  })

  it('abandons pending guards after system shutdown starts', async () => {
    const decision = Promise.withResolvers<boolean>()
    let nextGuardEvaluated = false
    application.registerQuitGuard(() => decision.promise)
    application.registerQuitGuard(() => {
      nextGuardEvaluated = true
      return true
    })
    requestNativeQuit()
    application.quit('system-shutdown')
    expect(acceptedExits).toBe(1)
    decision.resolve(true)
    await nextImmediate()
    expect(acceptedExits).toBe(1)
    expect(nextGuardEvaluated).toBe(false)
  })
})
