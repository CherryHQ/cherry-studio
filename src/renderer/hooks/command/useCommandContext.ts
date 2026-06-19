import { platform } from '@renderer/config/constant'
import type { ContextReader, ContextValue } from '@shared/command'
import { createContext, use, useEffect } from 'react'

export type RendererCommandContextKey =
  | 'platform'
  | 'feature.quick_assistant.enabled'
  | 'feature.selection.enabled'
  | 'chat.active'
  | 'topic.exists'
  | 'input.composing'

export type RegisterContextKey = (key: RendererCommandContextKey, value: ContextValue) => () => void

export const ContextKeySnapshotContext = createContext<ReadonlyMap<string, ContextValue> | null>(null)
export const ContextKeyRegisterContext = createContext<RegisterContextKey | null>(null)

export const rendererPlatform = platform ?? 'unknown'

const fallbackSnapshot = new Map<string, ContextValue>([['platform', rendererPlatform]])

export function useCommandContextSnapshot(): ReadonlyMap<string, ContextValue> {
  return use(ContextKeySnapshotContext) ?? fallbackSnapshot
}

export function useCommandContextReader(): ContextReader {
  return useCommandContextSnapshot()
}

export function useCommandContextKey(key: RendererCommandContextKey, value: ContextValue): void {
  const register = use(ContextKeyRegisterContext)

  useEffect(() => {
    return register?.(key, value)
  }, [key, register, value])
}
