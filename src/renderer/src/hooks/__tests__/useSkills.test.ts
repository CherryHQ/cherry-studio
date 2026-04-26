import type { InstalledSkill } from '@renderer/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInstalledSkills } from '../useSkills'

const mockList = vi.fn()
const mockToggle = vi.fn()
const mockUninstall = vi.fn()

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

describe('useInstalledSkills', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({
      success: true,
      data: [
        createSkill(),
        createSkill({ id: 'skill-2', name: 'Skill Two', folderName: 'skill-two', contentHash: 'hash-2' })
      ]
    })
    mockToggle.mockImplementation(async ({ skillId, isEnabled }) => ({
      success: true,
      data: createSkill({ id: skillId, isEnabled, updatedAt: '2024-01-02T00:00:00.000Z' })
    }))
    mockUninstall.mockResolvedValue({ success: true, data: null })

    ;(window as any).api = {
      skill: {
        list: mockList,
        toggle: mockToggle,
        uninstall: mockUninstall
      }
    }
  })

  afterEach(() => {
    delete (window as any).api
    vi.clearAllMocks()
  })

  it('updates the toggled skill in place without reloading the list', async () => {
    const { result } = renderHook(() => useInstalledSkills('agent-1'))

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2)
    })

    let toggleSuccess = false
    await act(async () => {
      toggleSuccess = await result.current.toggle('skill-1', true)
    })

    expect(toggleSuccess).toBe(true)
    expect(mockToggle).toHaveBeenCalledWith({ skillId: 'skill-1', agentId: 'agent-1', isEnabled: true })
    expect(mockList).toHaveBeenCalledTimes(1)
    expect(result.current.skills.find((skill) => skill.id === 'skill-1')).toEqual(
      createSkill({ id: 'skill-1', isEnabled: true, updatedAt: '2024-01-02T00:00:00.000Z' })
    )
  })
})
