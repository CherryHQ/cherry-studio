import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSharedMock, setSharedMock } = vi.hoisted(() => ({
  getSharedMock: vi.fn(),
  setSharedMock: vi.fn()
}))

import { clearWebSearchStatus, setWebSearchStatus } from '../status'

describe('setWebSearchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores status in shared cache for renderer observers', async () => {
    const cache = {
      getShared: getSharedMock,
      setShared: setSharedMock
    }

    getSharedMock.mockReturnValue({
      existing: {
        phase: 'default'
      }
    })

    await setWebSearchStatus(cache, 'request-1', {
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
    const cache = {
      getShared: getSharedMock,
      setShared: setSharedMock
    }

    getSharedMock.mockReturnValue({
      existing: {
        phase: 'fetch_complete',
        countAfter: 2
      },
      completed: {
        phase: 'cutoff'
      }
    })

    await clearWebSearchStatus(cache, 'completed')

    expect(getSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches')
    expect(setSharedMock).toHaveBeenCalledWith('chat.web_search.active_searches', {
      existing: {
        phase: 'fetch_complete',
        countAfter: 2
      }
    })
  })

  it('preserves overlapping status updates without clobbering other requests', async () => {
    const cache = {
      getShared: getSharedMock,
      setShared: setSharedMock
    }

    let sharedState = {} as Record<string, { phase: string; countAfter?: number }>
    getSharedMock.mockImplementation(() => sharedState)
    setSharedMock.mockImplementation((_, value) => {
      sharedState = value
    })

    await Promise.all([
      setWebSearchStatus(
        cache,
        'request-1',
        {
          phase: 'fetch_complete',
          countAfter: 1
        },
        10
      ),
      setWebSearchStatus(cache, 'request-2', {
        phase: 'cutoff'
      })
    ])

    expect(sharedState).toEqual({
      'request-1': {
        phase: 'fetch_complete',
        countAfter: 1
      },
      'request-2': {
        phase: 'cutoff'
      }
    })
  })
})
