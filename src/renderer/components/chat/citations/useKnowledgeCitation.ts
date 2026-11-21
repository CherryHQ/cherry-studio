import { useCallback, useEffect, useRef, useState } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { Citation } from '@renderer/types/message'
import type { KnowledgeCitationTarget } from '@shared/ipc/schemas/knowledge'

export function useKnowledgeCitation(citation: Citation) {
  const [target, setTarget] = useState<KnowledgeCitationTarget | null>(null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const { baseId, conceptId, sourceId, charStart, charEnd, page } = citation
  // Legacy and non-PDF citations retain their existing, non-clickable behavior.
  const canResolve = Boolean(baseId && conceptId && sourceId?.startsWith('kb-') && page)
  const resolve = useCallback(async () => {
    if (!canResolve || !baseId || !conceptId || !sourceId) return null
    const current = ++generation.current
    setFailed(false)
    try {
      const result = await ipcApi.request('knowledge.resolve_citation', {
        baseId,
        conceptId,
        id: sourceId,
        charStart,
        charEnd
      })
      if (current !== generation.current) return null
      setTarget(result)
      return result
    } catch {
      if (current === generation.current) setFailed(true)
      return null
    }
  }, [baseId, conceptId, sourceId, charStart, charEnd, canResolve])
  useEffect(() => {
    setTarget(null)
    setFailed(false)
    void resolve()
    return () => {
      generation.current++
    }
  }, [resolve])
  return { canResolve, target, failed, resolve }
}
