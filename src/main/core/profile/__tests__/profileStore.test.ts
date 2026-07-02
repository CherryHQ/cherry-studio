import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PROFILE_ID, type ProfileRegistry } from '../profileRegistry'
import {
  defaultRegistry,
  readProfileRegistry,
  resetBootProfileCache,
  resolveBootProfile,
  writeProfileRegistry
} from '../profileStore'

let dir: string
let configPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'profilestore-'))
  configPath = path.join(dir, 'profiles.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  resetBootProfileCache()
})

const withWork: ProfileRegistry = {
  activeProfileId: 'aBcDeF12',
  profiles: [
    { id: DEFAULT_PROFILE_ID, dataDir: DEFAULT_PROFILE_ID, name: 'Default', createdAt: 0 },
    { id: 'aBcDeF12', dataDir: 'Profiles/aBcDeF12', name: 'Work', createdAt: 1 }
  ]
}

describe('profile store I/O', () => {
  it('round-trips a written registry', () => {
    writeProfileRegistry(withWork, configPath)
    expect(readProfileRegistry(configPath)).toEqual(withWork)
  })

  it('falls back to the default registry when the file is missing', () => {
    expect(readProfileRegistry(configPath)).toEqual(defaultRegistry())
  })

  it('falls back to the default registry on corrupt JSON', () => {
    writeFileSync(configPath, '{ not json', 'utf-8')
    expect(readProfileRegistry(configPath)).toEqual(defaultRegistry())
  })

  it('injects the default profile when the file omits it', () => {
    writeFileSync(
      configPath,
      JSON.stringify({ activeProfileId: 'aBcDeF12', profiles: [withWork.profiles[1]] }),
      'utf-8'
    )
    const reg = readProfileRegistry(configPath)
    expect(reg.profiles.some((p) => p.id === DEFAULT_PROFILE_ID)).toBe(true)
    expect(reg.activeProfileId).toBe('aBcDeF12')
  })

  it('resets an activeProfileId that names no profile back to the default', () => {
    writeFileSync(configPath, JSON.stringify({ activeProfileId: 'ghost', profiles: [withWork.profiles[0]] }), 'utf-8')
    expect(readProfileRegistry(configPath).activeProfileId).toBe(DEFAULT_PROFILE_ID)
  })

  it('resolveBootProfile returns an entry and memoizes it', () => {
    resetBootProfileCache()
    const first = resolveBootProfile()
    expect(typeof first.id).toBe('string')
    expect(resolveBootProfile()).toBe(first)
  })
})
