import { compileSpecStream, createSpecStreamCompiler, type Spec } from '@json-render/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STREAM_THROTTLE_MS = 80

/**
 * Hook that compiles raw json-render content (JSONL SpecStream or direct JSON spec)
 * into a renderable Spec object. Handles both streaming and complete states.
 *
 * During streaming, spec updates are throttled to avoid excessive re-renders.
 */
export function useJsonRenderSpec(content: string, isStreaming: boolean) {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const compilerRef = useRef<ReturnType<typeof createSpecStreamCompiler> | null>(null)
  const lastLengthRef = useRef(0)
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSpecRef = useRef<Spec | null>(null)

  const safeContent = content ?? ''

  const isJsonl = useMemo(() => {
    const trimmed = safeContent.trimStart()
    return trimmed.startsWith('{"op":') || trimmed.startsWith('{"op" :')
  }, [safeContent])

  const flushPendingSpec = useCallback(() => {
    if (pendingSpecRef.current) {
      setSpec(pendingSpecRef.current)
      pendingSpecRef.current = null
    }
    throttleTimerRef.current = null
  }, [])

  useEffect(() => {
    if (!safeContent.trim()) {
      setSpec(null)
      setError(null)
      return
    }

    try {
      if (isJsonl) {
        if (isStreaming) {
          // Streaming JSONL: use incremental compiler
          if (!compilerRef.current) {
            compilerRef.current = createSpecStreamCompiler()
            lastLengthRef.current = 0
          }

          // Feed only new content since last update
          const newContent = safeContent.substring(lastLengthRef.current)
          if (newContent.trim()) {
            const { result } = compilerRef.current.push(newContent)
            pendingSpecRef.current = result as Spec

            // Throttle: batch rapid updates into one render per interval
            if (!throttleTimerRef.current) {
              flushPendingSpec()
              throttleTimerRef.current = setTimeout(flushPendingSpec, STREAM_THROTTLE_MS)
            }
          }
          lastLengthRef.current = safeContent.length
        } else {
          // Complete JSONL: compile all at once
          compilerRef.current = null
          lastLengthRef.current = 0
          const result = compileSpecStream(safeContent)
          setSpec(result as unknown as Spec)
        }
        setError(null)
      } else {
        // Direct JSON spec
        const parsed = JSON.parse(safeContent)
        if (parsed.root && parsed.elements) {
          setSpec(parsed as Spec)
          setError(null)
        } else {
          setSpec(null)
          setError('Invalid spec: missing "root" or "elements"')
        }
        compilerRef.current = null
        lastLengthRef.current = 0
      }
    } catch (e) {
      if (!isStreaming) {
        setError(e instanceof Error ? e.message : 'Failed to parse spec')
      }
    }
  }, [safeContent, isStreaming, isJsonl, flushPendingSpec])

  // Flush pending spec and reset compiler when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
      flushPendingSpec()
      compilerRef.current = null
      lastLengthRef.current = 0
    }
  }, [isStreaming, flushPendingSpec])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current)
      }
    }
  }, [])

  return { spec, error }
}
