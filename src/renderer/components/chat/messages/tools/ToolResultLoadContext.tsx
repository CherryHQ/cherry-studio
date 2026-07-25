import { createContext, use } from 'react'

const ToolResultLoadContext = createContext<(() => void) | null>(null)

export const ToolResultLoadProvider = ToolResultLoadContext.Provider

export function useRequestToolResult(): (() => void) | undefined {
  return use(ToolResultLoadContext) ?? undefined
}
