import { type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

import type { PaintingData } from '../model/types/paintingData'

function createSession(painting: PaintingData) {
  let pending: Promise<void> | undefined
  return {
    painting,
    deletedId: undefined as string | undefined,
    // Only persistence handoffs are ordered; the provider run stays in the background.
    write<T>(operation: () => Promise<T>): Promise<T> {
      const result = pending ? pending.then(operation) : operation()
      const settled = result.then(
        () => {},
        () => {}
      )
      pending = settled
      void settled.then(() => {
        if (pending === settled) pending = undefined
      })
      return result
    }
  }
}

/** Owns the editor and its persistence handoffs independently of generated record IDs. */
export function usePaintingSession(initialPainting: () => PaintingData) {
  const [painting, setPainting] = useState(initialPainting)
  const [sessionId, setSessionId] = useState(0)
  const current = useRef(createSession(painting))
  const mounted = useRef(true)
  const revision = useRef(0)
  const action = useRef(0)

  const update = useCallback((next: SetStateAction<PaintingData>) => {
    current.current.painting = typeof next === 'function' ? next(current.current.painting) : next
    setPainting(current.current.painting)
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
  const replace = useCallback((next: PaintingData) => {
    current.current = createSession(next)
    revision.current++
    setSessionId((id) => id + 1)
    setPainting(next)
  }, [])
  const capture = useCallback(() => {
    const owner = current.current
    return {
      getPainting: () => owner.painting,
      isSameSession: () => mounted.current && current.current === owner,
      isDeleted: () => owner.deletedId === owner.painting.id,
      markDeleted: (id: string) => {
        owner.deletedId = id
      },
      write: owner.write
    }
  }, [])
  const beginTransition = useCallback(() => {
    revision.current++
    const request = ++action.current
    const session = capture()
    const version = revision.current
    return {
      ...session,
      isCurrent: () => session.isSameSession() && revision.current === version,
      isLatestAction: () => session.isSameSession() && action.current === request
    }
  }, [capture])
  const bindEdit = useCallback(() => {
    const intent = beginTransition()
    return (patch: Parameters<typeof edit>[0]) => {
      if (intent.isLatestAction()) edit(patch)
    }
  }, [beginTransition, edit])
  const prepareGeneration = useCallback(
    <T>(prepare: () => Promise<T>) => {
      // A new Generate request is user intent; its later progress is not.
      touch()
      const owner = current.current
      return owner.write(async () => {
        if (owner.deletedId === owner.painting.id) return
        return prepare()
      })
    },
    [touch]
  )
  const bindGeneration = useCallback(() => {
    const owner = current.current
    return (next: PaintingData) => {
      owner.painting = {
        ...owner.painting,
        id: next.id,
        persistedAt: next.persistedAt,
        files: next.files,
        inputFiles: next.inputFiles,
        generationStatus: next.generationStatus,
        generationTaskId: next.generationTaskId,
        generationError: next.generationError,
        generationProgress: next.generationProgress
      }
      // Detached sessions still complete their pending save, without touching the visible editor.
      if (mounted.current && current.current === owner) setPainting(owner.painting)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return {
    painting,
    sessionId,
    update,
    touch,
    edit,
    replace,
    capture,
    beginTransition,
    bindEdit,
    bindGeneration,
    prepareGeneration
  }
}
