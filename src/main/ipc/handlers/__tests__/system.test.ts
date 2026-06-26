import { beforeEach, describe, expect, it, vi } from 'vitest'

const { autoDiscoverGitBash, getGitBashPathInfo, validateGitBashPath } = vi.hoisted(() => ({
  autoDiscoverGitBash: vi.fn(),
  getGitBashPathInfo: vi.fn(),
  validateGitBashPath: vi.fn()
}))

// Force the Windows code path so the Git Bash logic (not the off-Windows guards) is exercised.
vi.mock('@main/core/platform', async (importActual) => ({
  ...(await importActual<typeof import('@main/core/platform')>()),
  isWin: true
}))
vi.mock('@main/utils/process', () => ({ autoDiscoverGitBash, getGitBashPathInfo, validateGitBashPath }))

import { application } from '@application'

import { systemHandlers } from '../system'

const preferenceService = application.get('PreferenceService')
const ctx = { senderId: null }
const BASH = 'C:\\Git\\bin\\bash.exe'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(preferenceService.get).mockReset()
  vi.mocked(preferenceService.set).mockReset()
})

describe('systemHandlers — git_bash (Windows path)', () => {
  it('check returns true when a bash path is discovered, false otherwise', async () => {
    autoDiscoverGitBash.mockResolvedValueOnce(BASH)
    expect(await systemHandlers['system.git_bash.check'](undefined, ctx)).toBe(true)
    autoDiscoverGitBash.mockResolvedValueOnce(null)
    expect(await systemHandlers['system.git_bash.check'](undefined, ctx)).toBe(false)
  })

  it('get_path returns the stored Preference value', async () => {
    vi.mocked(preferenceService.get).mockReturnValue(BASH)
    expect(await systemHandlers['system.git_bash.get_path'](undefined, ctx)).toBe(BASH)
    expect(preferenceService.get).toHaveBeenCalledWith('feature.code_cli.git_bash_path')
  })

  it('get_path_info delegates to getGitBashPathInfo', async () => {
    getGitBashPathInfo.mockResolvedValue({ path: BASH, source: 'auto' })
    expect(await systemHandlers['system.git_bash.get_path_info'](undefined, ctx)).toEqual({
      path: BASH,
      source: 'auto'
    })
  })

  it('set_path persists a validated manual path', async () => {
    validateGitBashPath.mockReturnValue(BASH)
    expect(await systemHandlers['system.git_bash.set_path']({ path: BASH }, ctx)).toBe(true)
    expect(preferenceService.set).toHaveBeenCalledWith('feature.code_cli.git_bash_path', BASH)
    expect(preferenceService.set).toHaveBeenCalledWith('feature.code_cli.git_bash_path_source', 'manual')
  })

  it('set_path rejects an invalid path without persisting', async () => {
    validateGitBashPath.mockReturnValue(null)
    expect(await systemHandlers['system.git_bash.set_path']({ path: 'bad' }, ctx)).toBe(false)
    expect(preferenceService.set).not.toHaveBeenCalled()
  })

  it('set_path with null clears the setting and re-runs discovery', async () => {
    expect(await systemHandlers['system.git_bash.set_path']({ path: null }, ctx)).toBe(true)
    expect(preferenceService.set).toHaveBeenCalledWith('feature.code_cli.git_bash_path', null)
    expect(preferenceService.set).toHaveBeenCalledWith('feature.code_cli.git_bash_path_source', null)
    expect(autoDiscoverGitBash).toHaveBeenCalled()
  })
})
