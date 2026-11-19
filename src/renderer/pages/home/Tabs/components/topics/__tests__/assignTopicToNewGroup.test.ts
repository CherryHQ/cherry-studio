import { describe, expect, it, vi } from 'vitest'

import { assignTopicToNewGroup } from '../assignTopicToNewGroup'

describe('assignTopicToNewGroup', () => {
  it('keeps the group when the topic is assigned', async () => {
    const deleteGroup = vi.fn()
    const assign = vi.fn().mockResolvedValue(undefined)
    await assignTopicToNewGroup({ createGroup: async () => ({ id: 'g1' }), deleteGroup, assign })
    expect(assign).toHaveBeenCalledWith('g1')
    expect(deleteGroup).not.toHaveBeenCalled()
  })

  it('deletes the new group and rethrows when the topic can no longer be assigned', async () => {
    const deleteGroup = vi.fn().mockResolvedValue(undefined)
    const failure = new Error('topic is archived')
    await expect(
      assignTopicToNewGroup({
        createGroup: async () => ({ id: 'g2' }),
        deleteGroup,
        assign: vi.fn().mockRejectedValue(failure)
      })
    ).rejects.toBe(failure)
    expect(deleteGroup).toHaveBeenCalledExactlyOnceWith('g2')
  })

  it('still surfaces the assignment error when cleanup fails', async () => {
    const failure = new Error('topic is archived')
    await expect(
      assignTopicToNewGroup({
        createGroup: async () => ({ id: 'g3' }),
        deleteGroup: vi.fn().mockRejectedValue(new Error('delete failed')),
        assign: vi.fn().mockRejectedValue(failure)
      })
    ).rejects.toBe(failure)
  })
})
