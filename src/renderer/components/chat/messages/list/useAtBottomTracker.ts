/**
 * At-bottom state tracker.
 */

import { useCallback, useMemo, useRef } from 'react'

import { type AtBottomState, INITIAL_AT_BOTTOM_STATE, reduceAtBottom } from './atBottomStateMachine'

export interface AtBottomTracker {
  isAtBottom(): boolean
  getState(): AtBottomState
  notifyScroll(input: {
    offset: number
    scrollSize: number
    viewportSize: number
    direction: 'up' | 'down' | 'none'
  }): void
  notifySizeChange(input: { offset: number; scrollSize: number; viewportSize: number; prevScrollSize: number }): void
  notifyProgrammaticStick(): void
  reset(): void
}

export function useAtBottomTracker(): AtBottomTracker {
  const stateRef = useRef<AtBottomState>(INITIAL_AT_BOTTOM_STATE)

  const isAtBottom = useCallback(() => stateRef.current.atBottom, [])
  const getState = useCallback(() => stateRef.current, [])

  const notifyScroll = useCallback<AtBottomTracker['notifyScroll']>((input) => {
    stateRef.current = reduceAtBottom(stateRef.current, { type: 'user-scroll', ...input })
  }, [])

  const notifySizeChange = useCallback<AtBottomTracker['notifySizeChange']>((input) => {
    stateRef.current = reduceAtBottom(stateRef.current, { type: 'size-change', ...input })
  }, [])

  const notifyProgrammaticStick = useCallback(() => {
    stateRef.current = reduceAtBottom(stateRef.current, { type: 'programmatic-stick' })
  }, [])

  const reset = useCallback(() => {
    stateRef.current = reduceAtBottom(stateRef.current, { type: 'reset' })
  }, [])

  return useMemo(
    () => ({ isAtBottom, getState, notifyScroll, notifySizeChange, notifyProgrammaticStick, reset }),
    [getState, isAtBottom, notifyProgrammaticStick, notifyScroll, notifySizeChange, reset]
  )
}
