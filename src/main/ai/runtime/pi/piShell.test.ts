import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getBinaryShimsDir } from '@main/utils/binaryEnv'

import { mergeMiseEnvEntries, mergePiToolSpawnEnv, resolvePiLoginEnv } from './piShell'

const { CHERRY_MISE_DIR, CHERRY_SHIMS, USER_MISE_DIR, USER_SHIMS } = vi.hoisted(() => {
  const CHERRY_MISE_DIR = '/cherry/Toolchain/mise'
  const CHERRY_SHIMS = `${CHERRY_MISE_DIR}/shims`
  const USER_MISE_DIR = '/home/user/.local/share/mise'
  const USER_SHIMS = `${USER_MISE_DIR}/shims`
  return { CHERRY_MISE_DIR, CHERRY_SHIMS, USER_MISE_DIR, USER_SHIMS }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@main/utils/bundledGit', () => ({ getBundledGitDir: () => null }))
vi.mock('@main/utils/binaryEnv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/utils/binaryEnv')>()
  return {
    ...actual,
    getBinaryShimsDir: () => CHERRY_SHIMS,
    getBinarySearchDirs: () => [CHERRY_SHIMS, '/cherry/bin'],
    getBinaryExecutionEnv: () => ({
      MISE_DATA_DIR: CHERRY_MISE_DIR,
      MISE_CONFIG_DIR: `${CHERRY_MISE_DIR}/config`,
      MISE_CACHE_DIR: `${CHERRY_MISE_DIR}/cache`,
      MISE_STATE_DIR: `${CHERRY_MISE_DIR}/state`,
      MISE_SHIMS_DIR: CHERRY_SHIMS,
      MISE_YES: '1',
      MISE_NO_ANALYTICS: '1',
      MISE_EXPERIMENTAL: '1'
    })
  }
})

describe('mergePiToolSpawnEnv', () => {
  it('layers Cherry-managed tools onto Pi bash without dropping Pi PATH entries', () => {
    const result = mergePiToolSpawnEnv(
      { PATH: ['/pi/agent/bin', '/system/bin'].join(path.delimiter), PI_ONLY: 'preserved' },
      { loginPath: '/opt/homebrew/bin:/usr/bin', rawShellEnv: { PATH: '/usr/bin' } }
    )

    expect(result.PATH?.split(path.delimiter)).toEqual([
      CHERRY_SHIMS,
      '/cherry/bin',
      '/pi/agent/bin',
      '/system/bin',
      '/opt/homebrew/bin',
      '/usr/bin'
    ])
    expect(result).toMatchObject({
      PI_ONLY: 'preserved',
      MISE_DATA_DIR: CHERRY_MISE_DIR,
      MISE_SHIMS_DIR: CHERRY_SHIMS
    })
  })

  it('preserves a caller-owned mise environment instead of redirecting its shims', () => {
    const result = mergePiToolSpawnEnv(
      {
        PATH: [USER_SHIMS, CHERRY_SHIMS, '/system/bin'].join(path.delimiter),
        MISE_DATA_DIR: USER_MISE_DIR,
        MISE_SHIMS_DIR: USER_SHIMS
      },
      { loginPath: '/opt/homebrew/bin:/usr/bin', rawShellEnv: { PATH: '/usr/bin' } }
    )

    expect(result.PATH?.split(path.delimiter)).toEqual([
      USER_SHIMS,
      '/system/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/cherry/bin'
    ])
    expect(result).toMatchObject({
      MISE_DATA_DIR: USER_MISE_DIR,
      MISE_SHIMS_DIR: USER_SHIMS
    })
    expect(result.MISE_CONFIG_DIR).toBeUndefined()
    expect(result.PATH?.split(path.delimiter)).not.toContain(CHERRY_SHIMS)
  })

  it('drops Cherry mise shims and vars for a PATH-only user mise installation', () => {
    const result = mergePiToolSpawnEnv(
      { PATH: ['/pi/agent/bin', '/system/bin'].join(path.delimiter) },
      { loginPath: undefined, rawShellEnv: { PATH: [USER_SHIMS, '/usr/bin'].join(path.delimiter) } }
    )

    expect(result.MISE_DATA_DIR).toBeUndefined()
    expect(result.MISE_SHIMS_DIR).toBeUndefined()
    expect(result.MISE_CONFIG_DIR).toBeUndefined()
    expect(result.PATH?.split(path.delimiter)).not.toContain(CHERRY_SHIMS)
    expect(result.PATH?.split(path.delimiter)).toContain('/pi/agent/bin')
  })

  it('prefers the live spawn env mise values over a stale connection snapshot', () => {
    const result = mergePiToolSpawnEnv(
      {
        PATH: ['/pi/agent/bin', '/system/bin'].join(path.delimiter),
        MISE_DATA_DIR: '/live/mise'
      },
      { loginPath: undefined, rawShellEnv: { PATH: '/usr/bin', MISE_DATA_DIR: '/snapshot/mise' } }
    )

    expect(result.MISE_DATA_DIR).toBe('/live/mise')
    expect(result.PATH?.split(path.delimiter)).not.toContain(CHERRY_SHIMS)
  })

  it('layers the login-shell PATH into bash tool spawns, mirroring the shell prefix', () => {
    const result = mergePiToolSpawnEnv(
      { PATH: '/pi/agent/bin' },
      { loginPath: '/opt/homebrew/bin:/usr/bin', rawShellEnv: { PATH: '/usr/bin' } }
    )

    expect(result.PATH?.split(path.delimiter)).toContain('/opt/homebrew/bin')

    const withoutLogin = mergePiToolSpawnEnv(
      { PATH: '/pi/agent/bin' },
      { loginPath: undefined, rawShellEnv: { PATH: '/usr/bin' } }
    )
    expect(withoutLogin.PATH?.split(path.delimiter)).not.toContain('/opt/homebrew/bin')
  })

  it('keeps Cherry’s MISE contract when the login PATH carries Cherry’s own shims dir', () => {
    const result = mergePiToolSpawnEnv(
      { PATH: ['/pi/agent/bin', '/system/bin'].join(path.delimiter) },
      {
        loginPath: [CHERRY_SHIMS, '/cherry/bin', '/usr/bin'].join(':'),
        rawShellEnv: { PATH: '/usr/bin' }
      }
    )

    expect(result.MISE_DATA_DIR).toBe(CHERRY_MISE_DIR)
    expect(result.PATH?.split(path.delimiter)).toContain(CHERRY_SHIMS)
  })
})

describe('resolvePiLoginEnv', () => {
  it('keeps Cherry shims out of the pi shell prefix when the user owns mise', () => {
    const env = resolvePiLoginEnv({ PATH: [USER_SHIMS, '/usr/bin'].join(path.delimiter) })

    expect(env.PATH?.split(path.delimiter)).toContain(USER_SHIMS)
    expect(env.PATH?.split(path.delimiter)).not.toContain(CHERRY_SHIMS)
    expect(env.PATH?.split(path.delimiter)).toContain('/cherry/bin')
  })

  it('layers the full Cherry contract when the user has no mise', () => {
    const env = resolvePiLoginEnv({ PATH: '/usr/bin' })

    expect(env.PATH?.split(path.delimiter)).toContain(CHERRY_SHIMS)
    expect(env.MISE_DATA_DIR).toBe(CHERRY_MISE_DIR)
  })
})

describe('mergeMiseEnvEntries', () => {
  it('merges snapshot and live MISE vars with live values winning', () => {
    expect(
      mergeMiseEnvEntries({ MISE_DATA_DIR: '/snapshot', MISE_SHIMS_DIR: '/snapshot/shims' }, { MISE_DATA_DIR: '/live' })
    ).toEqual({ MISE_DATA_DIR: '/live', MISE_SHIMS_DIR: '/snapshot/shims' })
  })

  it('collapses case-variant MISE keys into the live spelling on Windows', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(mergeMiseEnvEntries({ MISE_DATA_DIR: '/snapshot' }, { mise_data_dir: '/live' })).toEqual({
        mise_data_dir: '/live'
      })
    } finally {
      platformSpy.mockRestore()
    }
  })
})

// Guards the fixture assumption behind every Cherry-shims assertion above.
describe('piShell test fixtures', () => {
  it('points getBinaryShimsDir at the Cherry mise shims stub', () => {
    expect(getBinaryShimsDir()).toBe(CHERRY_SHIMS)
  })
})
