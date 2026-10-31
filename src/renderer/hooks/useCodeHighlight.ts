import { useCallback, useEffect, useRef, useState } from 'react'

import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import type { HighlightRange, HighlightResult } from '@renderer/types/codeHighlight'

interface UseCodeHighlightOptions {
  value: string
  language: string
  callerId: string
}

export function useCodeHighlight({ value, language, callerId }: UseCodeHighlightOptions) {
  const { activeCodeTheme, highlightRange, cleanupTokenizers } = useCodeStyle()
  type Request = {
    value: string
    language: string
    theme: string
    range: HighlightRange
    generation: number
    run: typeof highlightRange
    callerId: string
  }
  const [highlighted, setHighlighted] = useState<{ request: Request; result: HighlightResult } | null>(null)
  const pending = useRef<Request | null>(null)
  const processing = useRef(false)
  const generation = useRef(0)

  const highlightLines = useCallback(
    async (start: number, end: number) => {
      pending.current = {
        value,
        language,
        theme: activeCodeTheme,
        range: { start, end },
        generation: generation.current,
        run: highlightRange,
        callerId
      }
      if (processing.current) return
      processing.current = true
      try {
        while (pending.current) {
          const request = pending.current
          pending.current = null
          const result = await request.run(request.value, request.language, request.callerId, request.range)
          if (request.generation === generation.current && !pending.current) setHighlighted({ request, result })
        }
      } finally {
        processing.current = false
      }
    },
    [value, language, activeCodeTheme, highlightRange, callerId]
  )

  const resetHighlight = useCallback(() => {
    generation.current++
    pending.current = null
    setHighlighted(null)
    cleanupTokenizers(callerId)
  }, [cleanupTokenizers, callerId])

  useEffect(
    () => () => {
      generation.current++
      pending.current = null
      cleanupTokenizers(callerId)
    },
    [callerId, cleanupTokenizers]
  )

  const current = highlighted?.request
  const tokens = highlighted && current?.value === value && current.language === language ? highlighted.result : null
  return { tokens, highlightLines, resetHighlight }
}
