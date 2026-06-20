import { usePreference } from '@data/hooks/usePreference'
import {
  ContextKeyRegisterContext,
  ContextKeySnapshotContext,
  type RendererCommandContextKey,
  rendererPlatform
} from '@renderer/hooks/command'
import { ContextKeyService, type ContextValue } from '@shared/command'
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface ContextEntry {
  id: number
  value: ContextValue
}

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

export function CommandContextKeyProvider({ children }: { children: React.ReactNode }) {
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
