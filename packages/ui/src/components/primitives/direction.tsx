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

function DirectionProvider(props: DirectionProviderProps) {
  return <RadixDirectionProvider {...props} />
}

function useDirection(localDirection?: Direction): Direction {
  return useRadixDirection(localDirection)
}

function resolveInlineSide(side: LogicalSide, direction: Direction): PhysicalInlineSide {
  if (side === 'start') return direction === 'rtl' ? 'right' : 'left'
  return direction === 'rtl' ? 'left' : 'right'
}

export { DirectionProvider, resolveInlineSide, useDirection }
export type { Direction, DirectionProviderProps, LogicalSide, PhysicalInlineSide }
