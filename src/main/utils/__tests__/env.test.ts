import { describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isWin: false }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platform.isWin
  }
}))

import { getEnvironmentValue, mergeEnvironment } from '../env'

describe('child process environment', () => {
  it('applies mixed-case Windows overrides without leaving a competing inherited value', () => {
    platform.isWin = true
    const env = mergeEnvironment({ Path: 'inherited', Codex_Home: 'original' }, { PATH: 'selected', codex_home: 'new' })
    expect(getEnvironmentValue(env, 'Path')).toBe('selected')
    expect(getEnvironmentValue(env, 'CODEX_HOME')).toBe('new')
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toHaveLength(1)
    expect(getEnvironmentValue({ Codex_Home: 'custom' }, 'CODEX_HOME')).toBe('custom')
    const inherited = { Path: 'lower-priority', PATH: 'node-selected' }
    expect(getEnvironmentValue(inherited, 'path')).toBe('node-selected')
    expect(mergeEnvironment(inherited).PATH).toBe('node-selected')
    expect(mergeEnvironment(inherited, { path: 'explicit' }).PATH).toBe('explicit')
    expect(mergeEnvironment(inherited, { path: undefined })).not.toHaveProperty('PATH')
  })

  it('keeps distinct POSIX names and does not invent a missing uppercase override', () => {
    platform.isWin = false
    const env = mergeEnvironment({ PATH: 'original', CODEX_HOME: 'original' }, { Path: 'other', codex_home: 'other' })
    expect(env.PATH).toBe('original')
    expect(env.Path).toBe('other')
    expect(getEnvironmentValue({ codex_home: 'other' }, 'CODEX_HOME')).toBeUndefined()
  })
})
