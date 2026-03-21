import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSharedMock, setSharedMock } = vi.hoisted(() => ({
  getSharedMock: vi.fn(),
  setSharedMock: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getShared: getSharedMock,
    setShared: setSharedMock
  }
}))

import { clearWebSearchStatus, setWebSearchStatus } from '../status'

describe('setWebSearchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores status in shared cache for renderer observers', async () => {
    getSharedMock.mockReturnValue({
      existing: {
        phase: 'default'
      }
    })

    await setWebSearchStatus('request-1', {
      phase: 'fetch_complete',
      countAfter: 2
    })

    expect(getSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches')
    expect(setSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches', {
      existing: {
        phase: 'default'
      },
      'request-1': {
        phase: 'fetch_complete',
        countAfter: 2
      }
    })
  })

  it('clears status for a completed request', async () => {
    getSharedMock.mockReturnValue({
      existing: {
        phase: 'fetch_complete',
        countAfter: 2
      },
      completed: {
        phase: 'cutoff'
      }
    })

    await clearWebSearchStatus('completed')

    expect(getSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches')
    expect(setSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches', {
      existing: {
        phase: 'fetch_complete',
        countAfter: 2
      }
    })
  })
})
