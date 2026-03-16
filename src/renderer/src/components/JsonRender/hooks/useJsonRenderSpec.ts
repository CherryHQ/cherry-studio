import { compileSpecStream, createSpecStreamCompiler, type Spec } from '@json-render/core'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Hook that compiles raw json-render content (JSONL SpecStream or direct JSON spec)
 * into a renderable Spec object. Handles both streaming and complete states.
 *
 * @param content - Raw string content from the code block
 * @param isStreaming - Whether content is still being streamed
 */
export function useJsonRenderSpec(content: string, isStreaming: boolean) {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const compilerRef = useRef<ReturnType<typeof createSpecStreamCompiler> | null>(null)
  const lastLengthRef = useRef(0)

  const safeContent = content ?? ''

  const isJsonl = useMemo(() => {
    const trimmed = safeContent.trimStart()
    return trimmed.startsWith('{"op":') || trimmed.startsWith('{"op" :')
  }, [safeContent])

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
            setSpec(result as Spec)
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
      // During streaming, partial parse errors are expected — don't overwrite spec
    }
  }, [safeContent, isStreaming, isJsonl])

  // Reset compiler when streaming restarts
  useEffect(() => {
    if (!isStreaming) {
      compilerRef.current = null
      lastLengthRef.current = 0
    }
  }, [isStreaming])

  return { spec, error }
}
