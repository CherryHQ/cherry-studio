import { describe, expect, it } from 'vitest'

import { resolveConversationIslandMotion } from '../conversationIslandMotion'

describe('resolveConversationIslandMotion', () => {
  it('uses the presentation spring when the island appears', () => {
    expect(resolveConversationIslandMotion({ exiting: false, reducedMotion: false })).toEqual({
      initial: { opacity: 0, scaleX: 0.9, scaleY: 0.72 },
      animate: { opacity: 1, scaleX: 1, scaleY: 1 },
      transition: { type: 'spring', stiffness: 224, damping: 25, mass: 1 }
    })
  })

  it('uses the approved exit target and timing while exiting', () => {
    expect(resolveConversationIslandMotion({ exiting: true, reducedMotion: false })).toEqual({
      initial: false,
      animate: { opacity: 0, scaleX: 0.96, scaleY: 0.82 },
      transition: { duration: 0.18, ease: [0.4, 0, 1, 1] }
    })
  })

  it('shows the visible target immediately when motion is reduced', () => {
    expect(resolveConversationIslandMotion({ exiting: true, reducedMotion: true })).toEqual({
      initial: false,
      animate: { opacity: 1, scaleX: 1, scaleY: 1 },
      transition: { duration: 0 }
    })
  })
})
