import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadFreshEmojiData = async () => {
  vi.resetModules()
  const { loadStableEmojiOptions } = await import('../data')
  return loadStableEmojiOptions
}

describe('loadStableEmojiOptions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects failed responses and retries the next load instead of keeping the rejected cache entry', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const loadStableEmojiOptions = await loadFreshEmojiData()

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

    await expect(loadStableEmojiOptions('en-US')).rejects.toThrow('Failed to load emoji data')
    await expect(loadStableEmojiOptions('en-US')).resolves.toEqual([
      { emoji: '🙂', annotation: 'smile', group: 0, order: 1 }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after json parsing failures instead of keeping the rejected cache entry', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const loadStableEmojiOptions = await loadFreshEmojiData()

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

    await expect(loadStableEmojiOptions('en-US')).rejects.toThrow('invalid json')
    await expect(loadStableEmojiOptions('en-US')).resolves.toEqual([
      { emoji: '🙂', annotation: 'smile', group: 0, order: 1 }
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns valid avatar emoji options even when Fluent artwork is unavailable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const loadStableEmojiOptions = await loadFreshEmojiData()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([
        { emoji: '😀', annotation: 'grinning face', group: 0, order: 1, version: 1 },
        { emoji: '👨‍👩‍👧‍👦', annotation: 'family', group: 0, order: 2, version: 2 },
        { emoji: '🫠', annotation: 'melting face', group: 0, order: 3, version: 14 },
        { emoji: '🏳️', annotation: 'white flag', group: 9, order: 4, version: 1 }
      ])
    })

    await expect(loadStableEmojiOptions('en-US')).resolves.toEqual([
      { emoji: '😀', annotation: 'grinning face', group: 0, order: 1, version: 1 },
      { emoji: '👨‍👩‍👧‍👦', annotation: 'family', group: 0, order: 2, version: 2 },
      { emoji: '🫠', annotation: 'melting face', group: 0, order: 3, version: 14 }
    ])
  })
})
