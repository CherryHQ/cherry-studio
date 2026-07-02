import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileRegistry } from '../profileRegistry'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  registry: null as ProfileRegistry | null,
  writes: [] as ProfileRegistry[]
}))

vi.mock('@application', () => ({
  application: {
    deactivateProfile: vi.fn(async () => {
      h.calls.push('deactivate')
    }),
    activateProfile: vi.fn(async (ctx: { profileId: string }) => {
      h.calls.push(`activate:${ctx.profileId}`)
    }),
    setProfilePathRegistry: vi.fn((profileRoot: string) => {
      h.calls.push(`repoint:${profileRoot}`)
    }),
    getPath: vi.fn(() => '/userData'),
    get: vi.fn((name: string) => {
      if (name === 'JobManager') {
        return {
          recoverActiveProfile: async () => {
            h.calls.push('recover')
          }
        }
      }
      if (name === 'WindowManager') {
        return { suspendPool: () => 0, getWindowsByType: () => [], getWindowId: () => undefined, close: () => true }
      }
      return { reloadMainWindow: () => h.calls.push('reload') } // MainWindowService
    })
  }
}))

vi.mock('../profileStore', () => ({
  readProfileRegistry: () => h.registry,
  writeProfileRegistry: (registry: ProfileRegistry) => {
    h.writes.push(registry)
    h.calls.push('commit')
  }
}))

const { application } = await import('@application')
const { ProfileService, ProfileSwitchError } = await import('../ProfileService')

beforeEach(() => {
  BaseService.resetInstances()
  h.calls = []
  h.writes = []
  h.registry = {
    activeProfileId: 'default',
    profiles: [
      { id: 'default', dataDir: 'default', name: 'Default', createdAt: 0 },
      { id: 'work', dataDir: 'Profiles/work', name: 'Work', createdAt: 1 }
    ]
  }
  vi.mocked(application.activateProfile).mockImplementation(async (ctx: { profileId: string }) => {
    h.calls.push(`activate:${ctx.profileId}`)
  })
})

describe('ProfileService.switchProfile', () => {
  it('runs deactivate → repoint → activate → commit → reset, then fires', async () => {
    const svc = new ProfileService()
    const switched = vi.fn()
    svc.onProfileDidSwitch(switched)

    await svc.switchProfile('work')

    expect(h.calls).toEqual([
      'deactivate',
      'repoint:/userData/Profiles/work',
      'activate:work',
      'recover',
      'commit',
      'reload'
    ])
    expect(h.writes[0].activeProfileId).toBe('work')
    expect(switched).toHaveBeenCalledWith('work')
    expect(svc.isSwitching()).toBe(false)
  })

  it('rolls back to the previous profile (convergent) and does not commit when activate fails', async () => {
    const svc = new ProfileService()
    // Target activation fails; the rollback activation (previous) then succeeds.
    vi.mocked(application.activateProfile).mockImplementationOnce(async () => {
      throw new Error('activate failed')
    })

    await expect(svc.switchProfile('work')).rejects.toBeInstanceOf(ProfileSwitchError)

    expect(h.calls).toEqual([
      'deactivate',
      'repoint:/userData/Profiles/work',
      'repoint:/userData', // rollback repoints to the default (previous) root
      'activate:default',
      'recover' // rollback re-arms the restored profile, symmetric with the happy path
    ])
    expect(h.calls).not.toContain('commit')
    expect(svc.isSwitching()).toBe(false)
  })

  it('rejects an unknown profile without deactivating', async () => {
    const svc = new ProfileService()
    await expect(svc.switchProfile('ghost')).rejects.toBeInstanceOf(ProfileSwitchError)
    expect(h.calls).toEqual([])
  })

  it('is a no-op when the target is already active', async () => {
    const svc = new ProfileService()
    await svc.switchProfile('default')
    expect(h.calls).toEqual([])
  })
})

describe('ProfileService CRUD', () => {
  it('createProfile generates an id and persists the new entry', () => {
    const svc = new ProfileService()
    const entry = svc.createProfile('New')
    expect(entry.id).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(entry.dataDir).toBe(`Profiles/${entry.id}`)
    expect(h.writes[0].profiles.map((p) => p.name)).toContain('New')
  })
})
