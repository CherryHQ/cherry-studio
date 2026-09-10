import {
  DirectionProvider as RadixDirectionProvider,
  useDirection as useRadixDirection
} from '@radix-ui/react-direction'
import type { ReactNode } from 'react'

type Direction = 'ltr' | 'rtl'
interface DirectionProviderProps {
  children?: ReactNode
  dir: Direction
}

/**
 * Provides the application direction to Radix and direction-aware components. Each renderer root
 * mounts this provider with the same application-owned value and synchronizes its document `dir`.
 */
function DirectionProvider({ children, dir }: DirectionProviderProps) {
  return <RadixDirectionProvider dir={dir}>{children}</RadixDirectionProvider>
}

/** Defaults to `ltr` when no provider is mounted. */
function useDirection(): Direction {
  return useRadixDirection()
}

export { DirectionProvider, useDirection }
export type { Direction }
