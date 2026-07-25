import { describe, expect, it } from 'vitest'

import {
  type AtBottomState,
  DEFAULT_AT_BOTTOM_TOLERANCE_PX,
  INITIAL_AT_BOTTOM_STATE,
  isCloseToBottom,
  reduceAtBottom,
  shouldStickOnGrow
} from '../atBottomStateMachine'

const atBottom = (offset: number, scrollSize: number, viewportSize: number) => ({
  offset,
  scrollSize,
  viewportSize
})

describe('isCloseToBottom', () => {
  it('returns true when within tolerance', () => {
    expect(isCloseToBottom(1992, 2000, 8)).toBe(true)
    expect(isCloseToBottom(1990, 2000, 8, DEFAULT_AT_BOTTOM_TOLERANCE_PX)).toBe(true)
  })

  it('returns false when beyond tolerance', () => {
    expect(isCloseToBottom(1700, 2000, 100)).toBe(false)
  })

  it('honors custom tolerance (Safari uses 5)', () => {
    // pixels away from bottom = scrollSize - offset - viewportSize
    expect(isCloseToBottom(1990, 2010, 10, 5)).toBe(false) // 10 px away, tol 5
    expect(isCloseToBottom(1995, 2010, 10, 5)).toBe(true) //  5 px away, tol 5
  })
})

describe('reduceAtBottom', () => {
  it('initial state is not-at-bottom, reason initial', () => {
    expect(INITIAL_AT_BOTTOM_STATE).toEqual({ atBottom: false, reason: 'initial' })
  })

  describe('measure input', () => {
    it('transitions to at-bottom when close', () => {
      const next = reduceAtBottom(INITIAL_AT_BOTTOM_STATE, {
        type: 'measure',
        ...atBottom(1000, 1000, 500)
      })
      expect(next).toEqual({ atBottom: true, reason: 'size-stayed-at-bottom' })
    })

    it('stays not-at-bottom when scrolled away', () => {
      const next = reduceAtBottom(INITIAL_AT_BOTTOM_STATE, {
        type: 'measure',
        ...atBottom(200, 1000, 500)
      })
      expect(next).toBe(INITIAL_AT_BOTTOM_STATE)
    })

    it('preserves at-bottom identity when still at bottom', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'scrolled-to-bottom' }
      const next = reduceAtBottom(prev, { type: 'measure', ...atBottom(495, 1000, 500) })
      expect(next).toBe(prev)
    })

    it('transitions at-bottom → scrolled-not-bottom when no longer close', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'scrolled-to-bottom' }
      const next = reduceAtBottom(prev, { type: 'measure', ...atBottom(100, 1000, 500) })
      expect(next).toEqual({ atBottom: false, reason: 'scrolled-not-bottom' })
    })
  })

  describe('user-scroll input', () => {
    it('reaching bottom always resumes auto-stick', () => {
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'down',
        userInitiated: true,
        ...atBottom(495, 1000, 500)
      })
      expect(next).toEqual({ atBottom: true, reason: 'scrolled-to-bottom' })
    })

    it('upward scroll away from bottom latches user-scrolled-up', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'up',
        userInitiated: true,
        ...atBottom(200, 1000, 500)
      })
      expect(next).toEqual({ atBottom: false, reason: 'user-scrolled-up' })
    })

    it('programmatic downward scroll preserves the active bottom-follow latch', () => {
      // End-of-animation scroll events (programmatic) fire with direction='down'
      // when the smooth-scroll lands at what was the bottom moments ago but is
      // no longer close due to newer content. Latching user-scrolled-up there
      // would kill auto-stick for the rest of the stream.
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'down',
        userInitiated: false,
        ...atBottom(300, 1000, 500)
      })
      expect(next).toBe(prev)
    })

    it('programmatic scroll (direction none) preserves prior user latch', () => {
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'none',
        userInitiated: false,
        ...atBottom(200, 1000, 500)
      })
      expect(next).toBe(prev)
    })

    it('downward scroll that does not reach bottom preserves prior user latch', () => {
      // virtua's remeasure compensation reports direction 'down' with no user
      // input; clearing the latch here would let the next in-tolerance size
      // change re-engage auto-stick behind the user's back.
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'down',
        userInitiated: false,
        ...atBottom(200, 1000, 500)
      })
      expect(next).toBe(prev)
    })

    it('reaching bottom from already-at-bottom skips redundant transition', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'scrolled-to-bottom' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'down',
        userInitiated: true,
        ...atBottom(495, 1000, 500)
      })
      expect(next).toBe(prev)
    })

    it('user upward scroll latches out even within the at-bottom tolerance', () => {
      // Right after a top-pin releases, the viewport still measures within the
      // effective bottom's tolerance. A small upward user gesture there is an
      // intent to read — it must not be re-latched into bottom-follow.
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'up',
        userInitiated: true,
        ...atBottom(470, 1000, 500)
      })
      expect(next).toEqual({ atBottom: false, reason: 'user-scrolled-up' })
    })

    it('programmatic upward jump within tolerance keeps following', () => {
      // virtua's remeasure compensation moves scrollTop backward mid-stream with
      // no user input; treating it as intent would kill an active bottom-follow.
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'up',
        userInitiated: false,
        ...atBottom(470, 1000, 500)
      })
      expect(next).toBe(prev)
    })

    it('programmatic upward jump outside tolerance also keeps following', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'user-scroll',
        direction: 'up',
        userInitiated: false,
        ...atBottom(200, 1000, 500)
      })

      expect(next).toBe(prev)
    })
  })

  describe('size-change input', () => {
    it('still at bottom after growth preserves at-bottom', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'size-change',
        offset: 1495,
        scrollSize: 2000,
        viewportSize: 500
      })
      expect(next).toBe(prev)
    })

    it('growth that pushes user off the bottom flags size-grew-past-viewport', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, {
        type: 'size-change',
        offset: 995,
        scrollSize: 2000,
        viewportSize: 500
      })
      expect(next).toEqual({ atBottom: false, reason: 'size-grew-past-viewport' })
    })

    it('preserves user-scrolled-up latch across size growth', () => {
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      const next = reduceAtBottom(prev, {
        type: 'size-change',
        offset: 100,
        scrollSize: 2000,
        viewportSize: 500
      })
      expect(next).toBe(prev)
    })

    it('preserves user-scrolled-up latch even within the at-bottom tolerance', () => {
      // A short expanded block near the live edge keeps the viewport within
      // tolerance; that geometry must not re-engage auto-stick over the latch.
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      const next = reduceAtBottom(prev, {
        type: 'size-change',
        offset: 1460,
        scrollSize: 2000,
        viewportSize: 500
      })
      expect(next).toBe(prev)
    })

    it('not-at-bottom + non-user state recomputes', () => {
      const prev: AtBottomState = { atBottom: false, reason: 'initial' }
      const next = reduceAtBottom(prev, {
        type: 'size-change',
        offset: 1495,
        scrollSize: 2000,
        viewportSize: 500
      })
      expect(next).toEqual({ atBottom: true, reason: 'size-stayed-at-bottom' })
    })
  })

  describe('user-took-control input', () => {
    it('latches user-scrolled-up from at-bottom (expand during bottom-follow)', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'stuck-on-grow' }
      const next = reduceAtBottom(prev, { type: 'user-took-control' })
      expect(next).toEqual({ atBottom: false, reason: 'user-scrolled-up' })
    })

    it('is idempotent when already latched', () => {
      const prev: AtBottomState = { atBottom: false, reason: 'user-scrolled-up' }
      expect(reduceAtBottom(prev, { type: 'user-took-control' })).toBe(prev)
    })

    it('user-scroll back to the bottom releases the latch', () => {
      let s = reduceAtBottom({ atBottom: true, reason: 'stuck-on-grow' }, { type: 'user-took-control' })
      s = reduceAtBottom(s, {
        type: 'user-scroll',
        direction: 'down',
        userInitiated: true,
        ...atBottom(495, 1000, 500)
      })
      expect(s).toEqual({ atBottom: true, reason: 'scrolled-to-bottom' })
    })
  })

  describe('programmatic-stick and reset', () => {
    it('programmatic-stick forces atBottom stuck-on-grow', () => {
      const next = reduceAtBottom(INITIAL_AT_BOTTOM_STATE, { type: 'programmatic-stick' })
      expect(next).toEqual({ atBottom: true, reason: 'stuck-on-grow' })
    })

    it('reset returns initial', () => {
      const prev: AtBottomState = { atBottom: true, reason: 'scrolled-to-bottom' }
      const next = reduceAtBottom(prev, { type: 'reset' })
      expect(next).toBe(INITIAL_AT_BOTTOM_STATE)
    })
  })

  it('full streaming cascade: scroll up, content keeps growing, scroll back down', () => {
    let s: AtBottomState = INITIAL_AT_BOTTOM_STATE

    s = reduceAtBottom(s, { type: 'measure', ...atBottom(495, 1000, 500) })
    expect(s.atBottom).toBe(true)

    s = reduceAtBottom(s, {
      type: 'size-change',
      offset: 495,
      scrollSize: 1200,
      viewportSize: 500
    })
    expect(s).toEqual({ atBottom: false, reason: 'size-grew-past-viewport' })

    s = reduceAtBottom(s, { type: 'programmatic-stick' })
    expect(s).toEqual({ atBottom: true, reason: 'stuck-on-grow' })

    s = reduceAtBottom(s, {
      type: 'user-scroll',
      direction: 'up',
      userInitiated: true,
      ...atBottom(400, 1200, 500)
    })
    expect(s).toEqual({ atBottom: false, reason: 'user-scrolled-up' })

    s = reduceAtBottom(s, {
      type: 'size-change',
      offset: 400,
      scrollSize: 1500,
      viewportSize: 500
    })
    expect(s).toEqual({ atBottom: false, reason: 'user-scrolled-up' })

    s = reduceAtBottom(s, {
      type: 'user-scroll',
      direction: 'down',
      userInitiated: true,
      ...atBottom(995, 1500, 500)
    })
    expect(s).toEqual({ atBottom: true, reason: 'scrolled-to-bottom' })
  })
})

describe('shouldStickOnGrow', () => {
  it('true when state is at-bottom', () => {
    expect(shouldStickOnGrow({ atBottom: true, reason: 'scrolled-to-bottom' })).toBe(true)
  })

  it('false when state is not-at-bottom (any reason)', () => {
    expect(shouldStickOnGrow({ atBottom: false, reason: 'user-scrolled-up' })).toBe(false)
    expect(shouldStickOnGrow({ atBottom: false, reason: 'size-grew-past-viewport' })).toBe(false)
  })
})
