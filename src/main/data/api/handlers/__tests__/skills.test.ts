import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getByIdMock, listMock, updateGlobalEnabledMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  listMock: vi.fn(),
  updateGlobalEnabledMock: vi.fn()
}))

vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: {
    getById: getByIdMock,
    list: listMock,
    updateGlobalEnabled: updateGlobalEnabledMock
  }
}))

import { skillHandlers } from '../skills'

describe('skillHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates only the global enabled state', async () => {
    const updated = { id: 'skill-1', isGlobalEnabled: false }
    updateGlobalEnabledMock.mockReturnValueOnce(updated)

    const result = await skillHandlers['/skills/:skillId'].PATCH({
      params: { skillId: 'skill-1' },
      body: { isGlobalEnabled: false }
    })

    expect(updateGlobalEnabledMock).toHaveBeenCalledWith('skill-1', false)
    expect(result).toBe(updated)
  })

  it('rejects fields outside the global toggle contract', async () => {
    await expect(
      skillHandlers['/skills/:skillId'].PATCH({
        params: { skillId: 'skill-1' },
        body: { isGlobalEnabled: false, isEnabled: true }
      } as never)
    ).rejects.toThrow()

    expect(updateGlobalEnabledMock).not.toHaveBeenCalled()
  })
})
