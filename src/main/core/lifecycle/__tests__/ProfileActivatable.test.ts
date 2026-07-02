import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../BaseService'
import type { ProfileActivatable, ProfileActivationContext } from '../profileActivation'

class FakeProfileService extends BaseService implements ProfileActivatable {
  onProfileActivate = vi.fn(async (_ctx: ProfileActivationContext) => {})
  onProfileDeactivate = vi.fn(async (_ctx: ProfileActivationContext) => {})
}

class PlainService extends BaseService {}

beforeEach(() => {
  BaseService.resetInstances()
})

describe('BaseService profile activation interpreter', () => {
  it('acquires when unbound', async () => {
    const s = new FakeProfileService()
    expect(await s._doProfileActivate({ profileId: 'A' })).toBe(true)
    expect(s.onProfileActivate).toHaveBeenCalledWith({ profileId: 'A' })
    expect(s.profileBinding).toEqual({ kind: 'bound', profileId: 'A' })
  })

  it('is idempotent for the same profile (no hook call)', async () => {
    const s = new FakeProfileService()
    await s._doProfileActivate({ profileId: 'A' })
    s.onProfileActivate.mockClear()
    expect(await s._doProfileActivate({ profileId: 'A' })).toBe(true)
    expect(s.onProfileActivate).not.toHaveBeenCalled()
  })

  it('converges when bound elsewhere: releases old then acquires new, in order', async () => {
    const s = new FakeProfileService()
    await s._doProfileActivate({ profileId: 'A' })
    const order: string[] = []
    s.onProfileDeactivate.mockImplementation(async (c) => {
      order.push(`deactivate:${c.profileId}`)
    })
    s.onProfileActivate.mockImplementation(async (c) => {
      order.push(`activate:${c.profileId}`)
    })
    await s._doProfileActivate({ profileId: 'B' })
    expect(order).toEqual(['deactivate:A', 'activate:B'])
    expect(s.profileBinding).toEqual({ kind: 'bound', profileId: 'B' })
  })

  it('deactivate releases using the bound profile id, then is unbound', async () => {
    const s = new FakeProfileService()
    await s._doProfileActivate({ profileId: 'A' })
    expect(await s._doProfileDeactivate()).toBe(true)
    expect(s.onProfileDeactivate).toHaveBeenCalledWith({ profileId: 'A' })
    expect(s.profileBinding).toEqual({ kind: 'unbound' })
  })

  it('deactivate is a no-op when unbound', async () => {
    const s = new FakeProfileService()
    expect(await s._doProfileDeactivate()).toBe(true)
    expect(s.onProfileDeactivate).not.toHaveBeenCalled()
  })

  it('leaves the binding unbound when onProfileActivate throws', async () => {
    const s = new FakeProfileService()
    s.onProfileActivate.mockRejectedValueOnce(new Error('boom'))
    await expect(s._doProfileActivate({ profileId: 'A' })).rejects.toThrow('boom')
    expect(s.profileBinding).toEqual({ kind: 'unbound' })
  })

  it('clears the binding even when onProfileDeactivate throws', async () => {
    const s = new FakeProfileService()
    await s._doProfileActivate({ profileId: 'A' })
    s.onProfileDeactivate.mockRejectedValueOnce(new Error('boom'))
    await expect(s._doProfileDeactivate()).rejects.toThrow('boom')
    expect(s.profileBinding).toEqual({ kind: 'unbound' })
  })

  it('is a no-op for services that do not implement ProfileActivatable', async () => {
    const s = new PlainService()
    expect(await s._doProfileActivate({ profileId: 'A' })).toBe(false)
    expect(await s._doProfileDeactivate()).toBe(false)
  })

  it('releases the bound profile on stop (shutdown safety net)', async () => {
    const s = new FakeProfileService()
    await s._doProfileActivate({ profileId: 'A' })
    await s._doStop()
    expect(s.onProfileDeactivate).toHaveBeenCalledWith({ profileId: 'A' })
    expect(s.profileBinding).toEqual({ kind: 'unbound' })
  })
})
