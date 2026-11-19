// Providers are components (renderer.md §3); their context and accessors live in hooks/.

import { type ReactNode, type RefObject, useMemo } from 'react'

import { ScrollViewportOwnershipContext } from '@renderer/hooks/useScrollViewportOwnership'

export const ScrollViewportOwnershipProvider = ({
  children,
  scrollContainerRef
}: {
  children: ReactNode
  scrollContainerRef: RefObject<HTMLElement | null>
}) => {
  const value = useMemo(() => ({ scrollContainerRef }), [scrollContainerRef])
  return <ScrollViewportOwnershipContext value={value}>{children}</ScrollViewportOwnershipContext>
}
