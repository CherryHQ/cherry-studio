import {
  DirectionProvider as RadixDirectionProvider,
  useDirection as useRadixDirection
} from '@radix-ui/react-direction'

type Direction = 'ltr' | 'rtl'
type LogicalSide = 'start' | 'end'
type PhysicalInlineSide = 'left' | 'right'

/**
 * Provides the application direction to Radix and JavaScript layout adapters. Each renderer root
 * mounts this provider with the same application-owned value and synchronizes its document `dir`.
 */
const DirectionProvider = RadixDirectionProvider

/** Defaults to `ltr` when no provider is mounted. */
function useDirection(): Direction {
  return useRadixDirection()
}

function resolveInlineSide(side: LogicalSide, direction: Direction): PhysicalInlineSide {
  if (side === 'start') return direction === 'rtl' ? 'right' : 'left'
  return direction === 'rtl' ? 'left' : 'right'
}

export { DirectionProvider, resolveInlineSide, useDirection }
export type { Direction, LogicalSide, PhysicalInlineSide }
