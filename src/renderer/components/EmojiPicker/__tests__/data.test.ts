import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadFreshEmojiData = async () => {
  vi.resetModules()
  const { loadEmojiData } = await import('../data')
  return loadEmojiData
}

describe('loadEmojiData', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects failed responses and retries the next load instead of keeping the rejected cache entry', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const loadEmojiData = await loadFreshEmojiData()

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: vi.fn()
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([{ emoji: '🙂', annotation: 'smile', group: 0, order: 1 }])
    })

    await expect(loadEmojiData('en-US')).rejects.toThrow('Failed to load emoji data')
    await expect(loadEmojiData('en-US')).resolves.toEqual([{ emoji: '🙂', annotation: 'smile', group: 0, order: 1 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after json parsing failures instead of keeping the rejected cache entry', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const loadEmojiData = await loadFreshEmojiData()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockRejectedValue(new Error('invalid json'))
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([
        { emoji: '🙂', annotation: 'smile', group: 0, order: 1 },
        { emoji: '🏳️', annotation: 'flag', group: 9, order: 2 }
      ])
    })

    await expect(loadEmojiData('en-US')).rejects.toThrow('invalid json')
    await expect(loadEmojiData('en-US')).resolves.toEqual([{ emoji: '🙂', annotation: 'smile', group: 0, order: 1 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
