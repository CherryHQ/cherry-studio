import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

import type { PaintingData } from '../model/types/paintingData'

/** Owns editor identity and user intent independently of generation record IDs. */
export function usePaintingSession(initialPainting: () => PaintingData) {
  const [painting, setPainting] = useState(initialPainting)
  const [sessionId, setSessionId] = useState(0)
  const current = useRef(painting)
  const identity = useRef({})
  const revision = useRef(0)
  const action = useRef(0)

  const update = useCallback((next: SetStateAction<PaintingData>) => {
    current.current = typeof next === 'function' ? next(current.current) : next
    setPainting(current.current)
  }, [])
  const touch = useCallback(() => {
    revision.current++
  }, [])
  const edit = useCallback(
    (patch: Partial<PaintingData> | ((painting: PaintingData) => Partial<PaintingData>)) => {
      touch()
      update((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
    },
    [touch, update]
  )
  const replace = useCallback(
    (next: PaintingData) => {
      identity.current = {}
      revision.current++
      setSessionId((id) => id + 1)
      update(next)
    },
    [update]
  )
  const beginTransition = useCallback(() => {
    revision.current++
    const request = ++action.current
    const owner = identity.current
    const version = revision.current
    return {
      getPainting: () => current.current,
      isCurrent: () => identity.current === owner && revision.current === version,
      // Typing does not supersede a model request; another request or navigation does.
      isLatestAction: () => identity.current === owner && action.current === request
    }
  }, [])
  const bindEdit = useCallback(() => {
    const intent = beginTransition()
    return (patch: Parameters<typeof edit>[0]) => {
      if (intent.isLatestAction()) edit(patch)
    }
  }, [beginTransition, edit])
  const bindGeneration = useCallback(() => {
    const owner = identity.current
    return (next: PaintingData) => {
      if (identity.current !== owner) return
      update((prev) => ({
        ...prev,
        id: next.id,
        persistedAt: next.persistedAt,
        files: next.files,
        inputFiles: next.inputFiles,
        generationStatus: next.generationStatus,
        generationTaskId: next.generationTaskId,
        generationError: next.generationError,
        generationProgress: next.generationProgress
      }))
    }
  }, [update])

  useEffect(
    () => () => {
      identity.current = {}
    },
    []
  )

  return { painting, sessionId, update, touch, edit, replace, beginTransition, bindEdit, bindGeneration }
}
