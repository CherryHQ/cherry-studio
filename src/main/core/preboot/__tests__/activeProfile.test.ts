import { CHERRY_HOME } from '@main/core/paths/constants'
import { resolveBootProfile } from '@main/core/profile/profileStore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slot: null as [string, string] | null }))

vi.mock('@application', () => ({
  application: {
    setProfilePathRegistry: (profileRoot: string, credentialRoot: string) => {
      h.slot = [profileRoot, credentialRoot]
    }
  }
}))

vi.mock('@main/core/profile/profileStore', () => ({ resolveBootProfile: vi.fn() }))

const { installActiveProfilePathRegistry } = await import('../activeProfile')

beforeEach(() => {
  h.slot = null
})

describe('installActiveProfilePathRegistry (Seam A)', () => {
  it('installs an isolated slot for a non-default boot profile', () => {
    // The global electron mock resolves userData to /mock/userData.
    vi.mocked(resolveBootProfile).mockReturnValue({ id: 'work', dataDir: 'Profiles/work', name: 'Work', createdAt: 1 })
    installActiveProfilePathRegistry()
    expect(h.slot).toEqual(['/mock/userData/Profiles/work', '/mock/userData/Profiles/work'])
  })

  it('installs the legacy roots for the default boot profile', () => {
    vi.mocked(resolveBootProfile).mockReturnValue({ id: 'default', dataDir: 'default', name: 'Default', createdAt: 0 })
    installActiveProfilePathRegistry()
    expect(h.slot).toEqual(['/mock/userData', CHERRY_HOME])
  })
})
