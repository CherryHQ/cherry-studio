// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useViewportFollowState } from '../useViewportFollowState'

describe('useViewportFollowState', () => {
  it('waits in reading mode until scroll restoration chooses the initial position', () => {
    const { result } = renderHook(() => useViewportFollowState())

    expect(result.current.getState()).toEqual({ mode: 'reading', reason: 'initializing' })
  })

  it('changes mode only through explicit reading and following transitions', () => {
    const { result } = renderHook(() => useViewportFollowState())

    act(() => result.current.enterFollowing('restored-bottom'))
    expect(result.current.isFollowing()).toBe(true)

    act(() => result.current.enterReading('user-scrolled-up'))
    expect(result.current.getState()).toEqual({ mode: 'reading', reason: 'user-scrolled-up' })

    act(() => result.current.enterFollowing('user-reached-bottom'))
    expect(result.current.getState()).toEqual({ mode: 'following', reason: 'user-reached-bottom' })
  })
})
