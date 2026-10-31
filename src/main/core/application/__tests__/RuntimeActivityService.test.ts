import { defaultServiceInstances } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { RuntimeActivityService } from '../RuntimeActivityService'

describe('RuntimeActivityService', () => {
  const sleepHolds = new Set<symbol>()

  beforeEach(() => {
    BaseService.resetInstances()
    sleepHolds.clear()
    vi.spyOn(defaultServiceInstances.PowerService, 'preventSleep').mockImplementation(() => {
      const token = Symbol()
      sleepHolds.add(token)
      return {
        dispose: vi.fn(() => {
          sleepHolds.delete(token)
        })
      }
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps concurrent tasks active until their own handles are released', () => {
    const activity = new RuntimeActivityService()
    expect(activity.hasActiveTasks()).toBe(false)
    const first = activity.begin('first')
    const second = activity.begin('second')
    expect(activity.hasActiveTasks()).toBe(true)
    expect(sleepHolds.size).toBe(2)
    first.dispose()
    first.dispose()
    expect(activity.hasActiveTasks()).toBe(true)
    expect(sleepHolds.size).toBe(1)
    second.dispose()
    expect(activity.hasActiveTasks()).toBe(false)
    expect(sleepHolds.size).toBe(0)
  })

  it('tracks tasks independently of whether power prevention takes effect', () => {
    vi.mocked(defaultServiceInstances.PowerService.preventSleep).mockReturnValue({ dispose: vi.fn() })
    const activity = new RuntimeActivityService()
    const hold = activity.begin('without-power-blocker')
    expect(sleepHolds.size).toBe(0)
    expect(activity.hasActiveTasks()).toBe(true)
    hold.dispose()
    expect(activity.hasActiveTasks()).toBe(false)
  })

  it('releases outstanding power holds when the service stops', () => {
    const activity = new RuntimeActivityService()
    const hold = activity.begin('pending')
    activity['onStop']()
    expect(activity.hasActiveTasks()).toBe(false)
    expect(sleepHolds.size).toBe(0)
    hold.dispose()
    expect(sleepHolds.size).toBe(0)
  })
})
