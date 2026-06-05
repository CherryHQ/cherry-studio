import { usePreference } from '@data/hooks/usePreference'
import { platform } from '@renderer/config/constant'
import { ContextKeyService, type ContextReader, type ContextValue } from '@shared/command'
import React, { createContext, use, useCallback, useEffect, useRef, useState } from 'react'

export type RendererCommandContextKey =
  | 'platform'
  | 'feature.quick_assistant.enabled'
  | 'feature.selection.enabled'
  | 'chat.active'
  | 'topic.exists'
  | 'input.composing'

interface ContextEntry {
  id: number
  value: ContextValue
}

type RegisterContextKey = (key: RendererCommandContextKey, value: ContextValue) => () => void

const ContextKeySnapshotContext = createContext<ReadonlyMap<string, ContextValue> | null>(null)
const ContextKeyRegisterContext = createContext<RegisterContextKey | null>(null)
const rendererPlatform = platform ?? 'unknown'
const fallbackSnapshot = new Map<string, ContextValue>([['platform', rendererPlatform]])

const buildSnapshot = (
  baseValues: ReadonlyMap<RendererCommandContextKey, ContextValue>,
  stacks: ReadonlyMap<RendererCommandContextKey, readonly ContextEntry[]>
): ReadonlyMap<string, ContextValue> => {
  const service = new ContextKeyService()

  for (const [key, value] of baseValues) {
    service.set(key, value)
  }

  for (const [key, entries] of stacks) {
    const entry = entries.at(-1)
    service.set(key, entry?.value)
  }

  return service.snapshot()
}

export function ContextKeyProvider({ children }: { children: React.ReactNode }) {
  const [quickAssistantEnabled] = usePreference('feature.quick_assistant.enabled')
  const [selectionEnabled] = usePreference('feature.selection.enabled')
  const baseValuesRef = useRef(
    new Map<RendererCommandContextKey, ContextValue>([
      ['platform', rendererPlatform],
      ['feature.quick_assistant.enabled', quickAssistantEnabled],
      ['feature.selection.enabled', selectionEnabled]
    ])
  )
  const stacksRef = useRef(new Map<RendererCommandContextKey, ContextEntry[]>())
  const nextEntryIdRef = useRef(0)
  const [snapshot, setSnapshot] = useState(() => buildSnapshot(baseValuesRef.current, stacksRef.current))

  const publishSnapshot = useCallback(() => {
    setSnapshot(buildSnapshot(baseValuesRef.current, stacksRef.current))
  }, [])

  useEffect(() => {
    baseValuesRef.current.set('platform', rendererPlatform)
    baseValuesRef.current.set('feature.quick_assistant.enabled', quickAssistantEnabled)
    baseValuesRef.current.set('feature.selection.enabled', selectionEnabled)
    publishSnapshot()
  }, [publishSnapshot, quickAssistantEnabled, selectionEnabled])

  const register = useCallback(
    (key: RendererCommandContextKey, value: ContextValue) => {
      const entry: ContextEntry = {
        id: nextEntryIdRef.current++,
        value
      }
      const entries = stacksRef.current.get(key) ?? []
      entries.push(entry)
      stacksRef.current.set(key, entries)
      publishSnapshot()

      return () => {
        const currentEntries = stacksRef.current.get(key)
        if (!currentEntries) {
          return
        }

        const nextEntries = currentEntries.filter((current) => current.id !== entry.id)
        if (nextEntries.length > 0) {
          stacksRef.current.set(key, nextEntries)
        } else {
          stacksRef.current.delete(key)
        }
        publishSnapshot()
      }
    },
    [publishSnapshot]
  )

  return (
    <ContextKeyRegisterContext value={register}>
      <ContextKeySnapshotContext value={snapshot}>{children}</ContextKeySnapshotContext>
    </ContextKeyRegisterContext>
  )
}

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
