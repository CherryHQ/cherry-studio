import type { ReactNode } from 'react'
import { createContext, use } from 'react'

export type ComposerOverrideRenderInput = {
  className?: string
}

export type ComposerOverride = {
  id: string
  priority?: number
  render: (input: ComposerOverrideRenderInput) => ReactNode
}

export type ComposerContextValue = {
  overrides?: readonly ComposerOverride[]
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

export const ComposerContextProvider = ComposerContext.Provider

export function useComposerContext(): ComposerContextValue | null {
  return use(ComposerContext)
}

export function selectActiveComposerOverride(
  overrides: readonly ComposerOverride[] | null | undefined
): ComposerOverride | null {
  if (!overrides?.length) return null

  let active: ComposerOverride | null = null
  for (const override of overrides) {
    if (!active || (override.priority ?? 0) > (active.priority ?? 0)) {
      active = override
    }
  }

  return active
}
