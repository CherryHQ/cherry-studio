import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getRawShellEnv: vi.fn(),
  isWin: false
}))

vi.mock('@application', () => ({ application: { getPath: mocks.getPath } }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return mocks.isWin
  }
}))
vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: mocks.getRawShellEnv }))

import { getHermesHome, resolveHermesHome } from '../hermesHome'

describe('resolveHermesHome', () => {
  beforeEach(() => {
    mocks.isWin = false
    mocks.getPath.mockReset().mockImplementation((key: string) => {
      if (key === 'external.hermes.default_home') return '/home/test/.hermes'
      throw new Error(`Unexpected getPath(${key})`)
    })
  })

  it('prefers HERMES_HOME over the platform default, matching Windows env casing loosely', () => {
    mocks.isWin = true

    expect(resolveHermesHome({ hermes_home: ' /custom/hermes ' })).toBe(path.resolve('/custom/hermes'))
    expect(mocks.getPath).not.toHaveBeenCalled()
  })

  it('ignores a blank HERMES_HOME and falls back to the registered default', () => {
    expect(resolveHermesHome({ HERMES_HOME: '  ' })).toBe('/home/test/.hermes')
    expect(mocks.getPath).toHaveBeenCalledWith('external.hermes.default_home')
  })
})

describe('getHermesHome', () => {
  it('pins one home for the whole session, even for concurrent first calls', async () => {
    let resolveEnv!: (env: NodeJS.ProcessEnv) => void
    mocks.getRawShellEnv.mockReturnValue(
      new Promise<NodeJS.ProcessEnv>((resolve) => {
        resolveEnv = resolve
      })
    )

    const first = getHermesHome()
    const second = getHermesHome()
    resolveEnv({ HERMES_HOME: '/first/hermes' })
    await expect(first).resolves.toBe(path.resolve('/first/hermes'))
    await expect(second).resolves.toBe(path.resolve('/first/hermes'))

    mocks.getRawShellEnv.mockResolvedValue({ HERMES_HOME: '/second/hermes' })
    await expect(getHermesHome()).resolves.toBe(path.resolve('/first/hermes'))
    expect(mocks.getRawShellEnv).toHaveBeenCalledOnce()
  })
})
