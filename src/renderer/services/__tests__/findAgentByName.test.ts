import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'

import { findAgentByName } from '../findAgentByName'

describe('findAgentByName', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('finds an exact match beyond page one of matching descriptions/names', async () => {
    const match = { id: 'existing', name: 'Preset' }
    const get = vi
      .spyOn(dataApiService, 'get')
      .mockResolvedValueOnce({
        items: Array.from({ length: AGENTS_MAX_LIMIT }, (_, i) => ({ id: `${i}`, name: 'Other' })),
        total: AGENTS_MAX_LIMIT + 1,
        page: 1
      })
      .mockResolvedValueOnce({ items: [match], total: AGENTS_MAX_LIMIT + 1, page: 2 })
    expect(await findAgentByName('Preset')).toEqual(match)
    expect(get).toHaveBeenLastCalledWith('/agents', { query: { search: 'Preset', limit: AGENTS_MAX_LIMIT, page: 2 } })
  })

  it('returns a settled miss only after the whole result', async () => {
    vi.spyOn(dataApiService, 'get').mockResolvedValue({ items: [], total: 0, page: 1 })
    expect(await findAgentByName('Preset')).toBeUndefined()
  })

  it('propagates lookup errors instead of treating them as a miss', async () => {
    vi.spyOn(dataApiService, 'get').mockRejectedValue(new Error('offline'))
    await expect(findAgentByName('Preset')).rejects.toThrow('offline')
  })
})
