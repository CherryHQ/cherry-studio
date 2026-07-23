/**
 * Tests for the main-side DataApi data change publisher.
 *
 * Two layers:
 * 1. `notifyDataApiDataChange` behavior against the unified `@application` mock
 *    (broadcast wiring, empty-array short-circuit, delivery-boundary guard,
 *    failure isolation).
 * 2. A real-container smoke test: the notifier deliberately uses
 *    `application.get('WindowManager')` rather than `getOptional`. The unified
 *    mock's `get` never throws, so it cannot catch a regression to
 *    `getOptional`. This asserts the real `ServiceContainer` semantics the guard
 *    relies on — `getOptional` throws for a non-`@Conditional` service, and
 *    `get` lazily constructs it.
 */
import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { Injectable, ServicePhase } from '@main/core/lifecycle/decorators'
import { ServiceContainer } from '@main/core/lifecycle/ServiceContainer'
import { Phase } from '@main/core/lifecycle/types'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyDataApiDataChange } from '../dataApiDataChange'

const effects: DataApiDataChangeEffect[] = [
  { endpoint: '/topics', kind: 'membership', dimension: 'search', entityIds: ['t1'] },
  { endpoint: '/topics/:id', entityIds: ['t1'] }
]

describe('notifyDataApiDataChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the guard to its ready default; individual tests override.
    vi.mocked(application.isReady).mockReturnValue(true)
  })

  it('broadcasts the effects on the DataApi_DataChanged channel', () => {
    notifyDataApiDataChange(effects)

    const broadcast = vi.mocked(application.get('WindowManager').broadcast)
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith(IpcChannel.DataApi_DataChanged, effects)
  })

  it('short-circuits on an empty effects array (no broadcast)', () => {
    notifyDataApiDataChange([])

    expect(application.get('WindowManager').broadcast).not.toHaveBeenCalled()
  })

  it('drops the notification before bootstrap completes (isReady() === false)', () => {
    vi.mocked(application.isReady).mockReturnValue(false)

    expect(() => notifyDataApiDataChange(effects)).not.toThrow()
    expect(application.get('WindowManager').broadcast).not.toHaveBeenCalled()
  })

  it('logs a warning and does not rethrow when broadcast throws', () => {
    vi.mocked(application.get('WindowManager').broadcast).mockImplementationOnce(() => {
      throw new Error('broadcast boom')
    })

    expect(() => notifyDataApiDataChange(effects)).not.toThrow()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('data change notification failed', expect.any(Error))
  })
})

/**
 * Real-container semantics the `application.isReady()` + `get('WindowManager')`
 * guard depends on. WindowManager is registered `@Injectable` /
 * `@ServicePhase(Phase.WhenReady)` with no `@Conditional`; a probe service with
 * the same profile stands in for it here so we don't instantiate the real
 * (heavy) WindowManager.
 */
describe('notifyDataApiDataChange — real container semantics', () => {
  @Injectable('WindowManagerProbe')
  @ServicePhase(Phase.WhenReady)
  class WindowManagerProbe extends BaseService {}

  beforeEach(() => {
    ServiceContainer.reset()
    BaseService.resetInstances()
  })

  it('getOptional() throws for the non-conditional WindowManager-like service (why the notifier avoids it)', () => {
    const container = ServiceContainer.getInstance()
    container.register(WindowManagerProbe)

    expect(() => container.getOptional('WindowManagerProbe')).toThrow(/is not conditional/)
  })

  it('get() lazily constructs and returns the service instance', () => {
    const container = ServiceContainer.getInstance()
    container.register(WindowManagerProbe)

    expect(container.get('WindowManagerProbe')).toBeInstanceOf(WindowManagerProbe)
  })
})
