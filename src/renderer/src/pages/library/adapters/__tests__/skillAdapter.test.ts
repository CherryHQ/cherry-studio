import type { InstalledSkill } from '@shared/data/types/agent'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateMock = vi.hoisted(() => vi.fn())
const installSkillMock = vi.hoisted(() => vi.fn())
const installSkillFromZipMock = vi.hoisted(() => vi.fn())
const installSkillFromDirectoryMock = vi.hoisted(() => vi.fn())
const uninstallSkillMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useQuery: vi.fn()
}))

import { useSkillMutations, useSkillMutationsById } from '../skillAdapter'

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
    tags: [],
    contentHash: 'hash-1',
    isEnabled: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('skillAdapter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    installSkillMock.mockResolvedValue({ success: true, data: createSkill() })
    installSkillFromZipMock.mockResolvedValue({ success: true, data: createSkill({ id: 'skill-zip' }) })
    installSkillFromDirectoryMock.mockResolvedValue({
      success: true,
      data: createSkill({ id: 'skill-directory' })
    })
    uninstallSkillMock.mockResolvedValue({ success: true, data: undefined })

    vi.stubGlobal('api', {
      skill: {
        install: installSkillMock,
        installFromZip: installSkillFromZipMock,
        installFromDirectory: installSkillFromDirectoryMock,
        uninstall: uninstallSkillMock
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs skills through IPC for all install sources and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useSkillMutations())

    await act(async () => {
      await result.current.install('skills.sh:owner/repo/my-skill')
      await result.current.installFromZip('/tmp/my-skill.zip')
      await result.current.installFromDirectory('/tmp/my-skill')
    })

    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(installSkillFromZipMock).toHaveBeenCalledWith({ zipFilePath: '/tmp/my-skill.zip' })
    expect(installSkillFromDirectoryMock).toHaveBeenCalledWith({ directoryPath: '/tmp/my-skill' })
    expect(invalidateMock).toHaveBeenCalledTimes(3)
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('returns installed skill when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillMutations())

    let installed: InstalledSkill | undefined
    await act(async () => {
      installed = await result.current.install('skills.sh:owner/repo/my-skill')
    })

    expect(installed?.id).toBe('skill-1')
    expect(installSkillMock).toHaveBeenCalledWith({ installSource: 'skills.sh:owner/repo/my-skill' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('uninstalls skills through IPC and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('resolves uninstall when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })
})
