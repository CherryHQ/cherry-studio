import {
  DirectionProvider as RadixDirectionProvider,
  useDirection as useRadixDirection
} from '@radix-ui/react-direction'
import * as React from 'react'

type Direction = 'ltr' | 'rtl'
type LogicalSide = 'start' | 'end'
type PhysicalInlineSide = 'left' | 'right'

interface DirectionProviderProps {
  children?: React.ReactNode
  dir: Direction
}

/**
 * Publishes one direction to both consumers that resolve it: components reading `useDirection()`
 * and logical CSS (`ms-*`, `end-*`, `rtl:*`), which resolves against the rendered `dir` attribute.
 * The `display: contents` wrapper carries the attribute without taking part in layout, so the two
 * cannot disagree — a context-only provider would let a component anchor to one edge while its
 * classes anchor to the other.
 */
function DirectionProvider({ children, dir }: DirectionProviderProps) {
  return (
    <RadixDirectionProvider dir={dir}>
      <div dir={dir} style={{ display: 'contents' }}>
        {children}
      </div>
    </RadixDirectionProvider>
  )
}

/** Defaults to `ltr` when no provider is mounted. */
function useDirection(localDirection?: Direction): Direction {
  return useRadixDirection(localDirection)
}

function resolveInlineSide(side: LogicalSide, direction: Direction): PhysicalInlineSide {
  if (side === 'start') return direction === 'rtl' ? 'right' : 'left'
  return direction === 'rtl' ? 'left' : 'right'
}

export { DirectionProvider, resolveInlineSide, useDirection }
export type { Direction, DirectionProviderProps, LogicalSide, PhysicalInlineSide }
