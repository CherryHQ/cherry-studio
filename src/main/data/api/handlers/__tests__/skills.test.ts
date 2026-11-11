import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getByIdMock, listMock, updateFieldsMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  listMock: vi.fn(),
  updateFieldsMock: vi.fn()
}))

vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: {
    getById: getByIdMock,
    list: listMock,
    updateFields: updateFieldsMock
  }
}))

import { skillHandlers } from '../skills'

describe('skillHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates only the global enabled state', async () => {
    const updated = { id: 'skill-1', isGlobalEnabled: false }
    updateFieldsMock.mockReturnValueOnce(updated)

    const result = await skillHandlers['/skills/:skillId'].PATCH({
      params: { skillId: 'skill-1' },
      body: { isGlobalEnabled: false }
    })

    expect(updateFieldsMock).toHaveBeenCalledWith('skill-1', { isGlobalEnabled: false })
    expect(result).toBe(updated)
  })

  it('passes a normalized combined patch through and keeps missing skills as errors', async () => {
    updateFieldsMock.mockImplementation((_id, patch) => ({ id: 'skill-1', ...patch }))
    await expect(
      skillHandlers['/skills/:skillId'].PATCH({
        params: { skillId: 'skill-1' },
        body: { isGlobalEnabled: false, note: '  reminder  ' }
      })
    ).resolves.toEqual({ id: 'skill-1', isGlobalEnabled: false, note: 'reminder' })
    updateFieldsMock.mockReturnValueOnce(null)
    await expect(
      skillHandlers['/skills/:skillId'].PATCH({ params: { skillId: 'missing' }, body: { note: null } })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejects fields outside the global toggle contract', async () => {
    await expect(
      skillHandlers['/skills/:skillId'].PATCH({
        params: { skillId: 'skill-1' },
        body: { isGlobalEnabled: false, isEnabled: true }
      } as never)
    ).rejects.toThrow()

    expect(updateFieldsMock).not.toHaveBeenCalled()
  })
})
