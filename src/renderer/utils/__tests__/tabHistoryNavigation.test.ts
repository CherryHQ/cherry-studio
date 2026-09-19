import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { canGoForward, goTabHistoryBack, goTabHistoryForward } from '../tabHistoryNavigation'

describe('tabHistoryNavigation', () => {
  it('refuses back/forward at the ends and walks an isolated memory stack in between', () => {
    const history = createMemoryHistory({ initialEntries: ['/a'] })

    expect(history.canGoBack()).toBe(false)
    expect(canGoForward(history)).toBe(false)
    expect(goTabHistoryBack(history)).toBe(false)
    expect(goTabHistoryForward(history)).toBe(false)
    expect(history.location.pathname).toBe('/a')

    history.push('/b')
    history.push('/c')
    expect(history.location.pathname).toBe('/c')
    expect(history.canGoBack()).toBe(true)
    expect(canGoForward(history)).toBe(false)

    expect(goTabHistoryBack(history)).toBe(true)
    expect(history.location.pathname).toBe('/b')
    expect(canGoForward(history)).toBe(true)

    expect(goTabHistoryForward(history)).toBe(true)
    expect(history.location.pathname).toBe('/c')
    expect(canGoForward(history)).toBe(false)
    expect(goTabHistoryForward(history)).toBe(false)
    expect(history.location.pathname).toBe('/c')
  })
})
