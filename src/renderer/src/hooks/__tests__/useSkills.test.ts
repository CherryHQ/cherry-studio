import type { InstalledSkill } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useQueryMock = vi.hoisted(() => vi.fn())
const invalidateMock = vi.hoisted(() => vi.fn())
const toggleSkillMock = vi.hoisted(() => vi.fn())
const uninstallSkillMock = vi.hoisted(() => vi.fn())
const installSkillMock = vi.hoisted(() => vi.fn())
const installSkillFromZipMock = vi.hoisted(() => vi.fn())
const installSkillFromDirectoryMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: useQueryMock,
  useInvalidateCache: () => invalidateMock
}))

import { useInstalledSkills, useSkillInstall } from '../useSkills'

function createSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    name: 'Skill One',
    description: 'First skill',
    folderName: 'skill-one',
    source: 'builtin',
    sourceUrl: null,
    namespace: null,
    author: null,
    contentHash: 'hash-1',
    isEnabled: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('useInstalledSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const skills = [
      createSkill(),
      createSkill({ id: 'skill-2', name: 'Skill Two', folderName: 'skill-two', contentHash: 'hash-2' })
    ]

    useQueryMock.mockReturnValue({
      data: skills,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })

    invalidateMock.mockResolvedValue(undefined)
    toggleSkillMock.mockImplementation(async ({ skillId, isEnabled }) => ({
      success: true,
      data: createSkill({ id: skillId, isEnabled, updatedAt: '2024-01-02T00:00:00.000Z' })
    }))
    uninstallSkillMock.mockResolvedValue({ success: true, data: undefined })

    vi.stubGlobal('api', {
      skill: {
        toggle: toggleSkillMock,
        uninstall: uninstallSkillMock
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads skills with DataApi and toggles agent skill through IPC', async () => {
    const { result } = renderHook(() => useInstalledSkills('agent-1'))

    expect(result.current.skills).toHaveLength(2)
    expect(useQueryMock).toHaveBeenCalledWith('/skills', { query: { agentId: 'agent-1' } })

    let toggleSuccess = false
    await act(async () => {
      toggleSuccess = await result.current.toggle('skill-1', true)
    })

    expect(toggleSuccess).toBe(true)
    expect(toggleSkillMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      skillId: 'skill-1',
      isEnabled: true
    })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('uninstalls skills through IPC and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useInstalledSkills())

    let uninstallSuccess = false
    await act(async () => {
      uninstallSuccess = await result.current.uninstall('skill-1')
    })

    expect(uninstallSuccess).toBe(true)
    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('does not fail uninstall when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useInstalledSkills())

    let uninstallSuccess = false
    await act(async () => {
      uninstallSuccess = await result.current.uninstall('skill-1')
    })

    expect(uninstallSuccess).toBe(true)
    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('does not toggle when no agent context is provided', async () => {
    const { result } = renderHook(() => useInstalledSkills())

    let toggleSuccess = true
    await act(async () => {
      toggleSuccess = await result.current.toggle('skill-1', true)
    })

    expect(toggleSuccess).toBe(false)
    expect(toggleSkillMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })
})

describe('useSkillInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })
    invalidateMock.mockResolvedValue(undefined)
    installSkillMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-installed' }) })
    installSkillFromZipMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-zip' }) })
    installSkillFromDirectoryMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-directory' }) })

    vi.stubGlobal('api', {
      skill: {
        install: installSkillMock,
        installFromZip: installSkillFromZipMock,
        installFromDirectory: installSkillFromDirectoryMock
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs remote skills through IPC with installSource', async () => {
    const { result } = renderHook(() => useSkillInstall())

    await act(async () => {
      const { skill } = await result.current.install('skills.sh:owner/repo/my-skill')
      expect(skill?.id).toBe('skill-installed')
    })

    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('returns installed skill when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillInstall())

    let installResult: Awaited<ReturnType<typeof result.current.install>> | undefined
    await act(async () => {
      installResult = await result.current.install('skills.sh:owner/repo/my-skill')
    })

    expect(installResult?.skill?.id).toBe('skill-installed')
    expect(installResult?.error).toBeUndefined()
    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('installs local ZIP and directory skills through IPC', async () => {
    const { result } = renderHook(() => useSkillInstall())

    await act(async () => {
      await result.current.installFromZip('/tmp/my-skill.zip')
      await result.current.installFromDirectory('/tmp/my-skill')
    })

    expect(installSkillFromZipMock).toHaveBeenCalledWith({ zipFilePath: '/tmp/my-skill.zip' })
    expect(installSkillFromDirectoryMock).toHaveBeenCalledWith({ directoryPath: '/tmp/my-skill' })
    expect(invalidateMock).toHaveBeenCalledTimes(2)
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })
})
