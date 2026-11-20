import { describe, expect, it, vi } from 'vitest'

import { assignTopicToNewGroup } from '../assignTopicToNewGroup'

describe('assignTopicToNewGroup', () => {
  it('submits once with a fresh group id', async () => {
    const submit = vi.fn().mockResolvedValue('ok')
    await expect(assignTopicToNewGroup({ submit, newGroupId: () => 'g1' })).resolves.toBe('ok')
    expect(submit).toHaveBeenCalledExactlyOnceWith('g1')
  })

  it('retries a lost reply with the SAME group id so the server can replay the committed result', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('committed')
    await expect(assignTopicToNewGroup({ submit, newGroupId: () => 'g2' })).resolves.toBe('committed')
    expect(submit.mock.calls).toEqual([['g2'], ['g2']])
  })

  it('surfaces the rejection when the topic can no longer be assigned, without any client-side cleanup', async () => {
    const failure = new Error('topic is archived')
    const submit = vi.fn().mockRejectedValue(failure)
    await expect(assignTopicToNewGroup({ submit, newGroupId: () => 'g3' })).rejects.toBe(failure)
    expect(submit).toHaveBeenCalledTimes(2)
  })
})
