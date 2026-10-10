import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type ComposerDockPlacement = 'home' | 'docked'

const COMPOSER_DOCK_MOTION_CLEAR_DELAY_MS = 280

export type ComposerDockMotionTransition = 'home-to-docked'

export function useComposerDockMotionTransition(
  placement: ComposerDockPlacement
): ComposerDockMotionTransition | undefined {
  const previousPlacementRef = useRef(placement)
  const [transition, setTransition] = useState<ComposerDockMotionTransition | undefined>()

  useLayoutEffect(() => {
    const previousPlacement = previousPlacementRef.current
    previousPlacementRef.current = placement
    setTransition(previousPlacement === 'home' && placement === 'docked' ? 'home-to-docked' : undefined)
  }, [placement])

  useEffect(() => {
    if (!transition) return

    const timer = window.setTimeout(() => {
      setTransition(undefined)
    }, COMPOSER_DOCK_MOTION_CLEAR_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [transition])

  return transition
}

export function getComposerDockMotionAttributes(transition: ComposerDockMotionTransition | undefined):
  | {
      className: string
      motion: ComposerDockMotionTransition
    }
  | undefined {
  if (!transition) return undefined

  return {
    className: 'animation-chat-composer-dock-down',
    motion: transition
  }
}
