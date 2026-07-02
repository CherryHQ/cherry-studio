import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  addProfile,
  DEFAULT_PROFILE_ID,
  findEntry,
  generateProfileId,
  type ProfileEntry,
  type ProfileRegistry,
  renameProfile,
  resolveProfileRoots,
  setActive
} from '../profileRegistry'

const base: ProfileRegistry = {
  activeProfileId: DEFAULT_PROFILE_ID,
  profiles: [{ id: DEFAULT_PROFILE_ID, dataDir: DEFAULT_PROFILE_ID, name: 'Default', createdAt: 0 }]
}

describe('generateProfileId', () => {
  it('produces an 8-char base62 id', () => {
    const id = generateProfileId(new Set())
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/)
  })

  it('never returns an id already in use', () => {
    const first = generateProfileId(new Set())
    const second = generateProfileId(new Set([first]))
    expect(second).not.toBe(first)
  })

  it('never collides with the reserved default id (different length)', () => {
    expect(generateProfileId(new Set())).not.toBe(DEFAULT_PROFILE_ID)
  })
})

describe('registry transforms (pure)', () => {
  it('findEntry returns the matching entry or undefined', () => {
    expect(findEntry(base, DEFAULT_PROFILE_ID)?.name).toBe('Default')
    expect(findEntry(base, 'missing')).toBeUndefined()
  })

  it('addProfile appends without mutating the input', () => {
    const next = addProfile(base, { id: 'aBcDeF12', dataDir: 'Profiles/aBcDeF12', name: 'Work', createdAt: 1 })
    expect(next.profiles).toHaveLength(2)
    expect(findEntry(next, 'aBcDeF12')?.name).toBe('Work')
    expect(base.profiles).toHaveLength(1) // input untouched
  })

  it('renameProfile changes only the named profile', () => {
    const next = renameProfile(base, DEFAULT_PROFILE_ID, 'Renamed')
    expect(findEntry(next, DEFAULT_PROFILE_ID)?.name).toBe('Renamed')
    expect(base.profiles[0].name).toBe('Default') // input untouched
  })

  it('renameProfile is a no-op for an absent id', () => {
    const next = renameProfile(base, 'missing', 'X')
    expect(next.profiles.map((p) => p.name)).toEqual(['Default'])
  })

  it('setActive repoints activeProfileId', () => {
    expect(setActive(base, 'aBcDeF12').activeProfileId).toBe('aBcDeF12')
    expect(base.activeProfileId).toBe(DEFAULT_PROFILE_ID) // input untouched
  })
})

describe('resolveProfileRoots', () => {
  const userData = '/mock/userData'
  const cherryHome = '/mock/.cherrystudio'

  it('maps the default profile to the legacy roots (Data under userData, credentials under cherry home)', () => {
    const entry: ProfileEntry = { id: DEFAULT_PROFILE_ID, dataDir: DEFAULT_PROFILE_ID, name: 'Default', createdAt: 0 }
    expect(resolveProfileRoots(entry, userData, cherryHome)).toEqual({
      profileRoot: userData,
      credentialRoot: cherryHome
    })
  })

  it('isolates a non-default profile: both roots under <userData>/<dataDir>', () => {
    const entry: ProfileEntry = { id: 'aBcDeF12', dataDir: 'Profiles/aBcDeF12', name: 'Work', createdAt: 1 }
    const root = path.join(userData, 'Profiles/aBcDeF12')
    expect(resolveProfileRoots(entry, userData, cherryHome)).toEqual({ profileRoot: root, credentialRoot: root })
  })
})
