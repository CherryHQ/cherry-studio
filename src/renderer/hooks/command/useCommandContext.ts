import { createContext, use, useLayoutEffect, useSyncExternalStore } from 'react'

import { platform } from '@renderer/utils/platform'
import type { ContextReader, ContextValue } from '@shared/types/command'

import { CommandFocusScopeContext, readScopeContext } from './commandFocusScope'

export type RendererCommandContextKey =
  | 'resource.focused'
  | 'input.focused'
  | 'platform'
  | 'feature.quick_assistant.enabled'
  | 'feature.selection.enabled'
  | 'feature.screenshot.enabled'
  | 'chat.active'
  | 'topic.exists'
  | 'input.composing'
  | 'webview.focused'
  | 'chat.messages.focused'

export type RegisterContextKey = (key: RendererCommandContextKey, value: ContextValue) => () => void

export const ContextKeySnapshotContext = createContext<ReadonlyMap<string, ContextValue> | null>(null)
export const ContextKeyRegisterContext = createContext<RegisterContextKey | null>(null)

export const rendererPlatform = platform ?? 'unknown'

const fallbackSnapshot = new Map<string, ContextValue>([['platform', rendererPlatform]])

export function useCommandContextSnapshot(): ReadonlyMap<string, ContextValue> {
  return use(ContextKeySnapshotContext) ?? fallbackSnapshot
}

const noSubscription = () => () => {}
const zeroVersion = () => 0

export function useCommandContextReader(): ContextReader {
  const scope = use(CommandFocusScopeContext)
  const base = useCommandContextSnapshot()
  useSyncExternalStore(scope?.subscribe ?? noSubscription, scope?.getVersion ?? zeroVersion)
  return readScopeContext(scope, base)
}

export function useCommandContextKey(key: RendererCommandContextKey, value: ContextValue): void {
  const register = use(ContextKeyRegisterContext)
  const scope = use(CommandFocusScopeContext)

  useLayoutEffect(() => {
    return scope ? scope.registerContext(key, value) : register?.(key, value)
  }, [key, register, scope, value])
}
