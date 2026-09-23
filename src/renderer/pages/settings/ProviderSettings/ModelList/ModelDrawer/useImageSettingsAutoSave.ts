import { useCallback, useEffect, useRef, useState } from 'react'

import type { ImageGenerationConfig } from '@shared/ai/imageGenerationConfig'

/** Serial writes preserve the latest edit, including edits queued before the drawer closes. */
export function useImageSettingsAutoSave(
  value: ImageGenerationConfig,
  enabled: boolean,
  persist: (value: ImageGenerationConfig) => Promise<unknown>,
  onError: (error: unknown) => void
) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const callbacks = useRef({ persist, onError })
  callbacks.current = { persist, onError }
  const queue = useRef<{ value: ImageGenerationConfig; persist: typeof persist } | null>(null)
  const running = useRef(false)
  const lastQueued = useRef<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const enqueue = useCallback((next: ImageGenerationConfig) => {
    queue.current = { value: next, persist: callbacks.current.persist }
    if (running.current) return
    running.current = true
    if (mounted.current) {
      setSaving(true)
      setError(null)
    }
    void (async () => {
      try {
        while (queue.current) {
          const job = queue.current
          queue.current = null
          try {
            await job.persist(job.value)
            if (mounted.current) setError(null)
          } catch (cause) {
            if (!queue.current) {
              if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
              callbacks.current.onError(cause)
            }
          }
        }
      } finally {
        running.current = false
        if (mounted.current) setSaving(false)
      }
    })()
  }, [])
  useEffect(() => {
    if (!enabled) return
    const serialized = JSON.stringify(value)
    if (lastQueued.current === serialized) return
    lastQueued.current = serialized
    enqueue(value)
  }, [value, enabled, enqueue])
  return {
    saving,
    error,
    retry: () => {
      if (enabled) enqueue(value)
    }
  }
}
