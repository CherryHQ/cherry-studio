import type { FileEntry } from '@shared/data/types/file'
import { useCallback, useRef, useState } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { presentPaintingGenerationGuardFeedback } from '../utils/presentPaintingGenerationGuardFeedback'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingGenerationGuard } from './usePaintingGenerationGuard'

/** Resolves the composer's draft attachments into the entries a request consumes. */
export type MaterializeInputs = () => Promise<{ entries: FileEntry[]; complete: boolean }>

interface UsePaintingGenerationSubmitInput {
  painting: PaintingData
  onPaintingChange: (painting: PaintingData) => void
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

/**
 * Single owner of the painting generation request: `validate -> materialize ->
 * generate`, plus the re-entrancy guard, cancel, and the state the UI reads.
 *
 * **Materialization is part of the request, not a step before it.** It is injected
 * as a capability rather than passed as data because the draft attachments live in
 * the composer's tool context, below this hook in the tree — so the owner decides
 * *when* inputs are resolved while their holder only supplies *how*. Doing it the
 * other way round (composer materializes, then calls in) put irreversible side
 * effects ahead of a check that could have refused the request for free: a guard
 * failure would strand freshly-created `delete_when_unreferenced` entries that no
 * painting ref ever claims.
 *
 * Two gates, deliberately at different points:
 * - `validateBeforeGenerate` asks whether a request is possible at all
 *   (provider enabled, model present and resolvable). Cheap and side-effect free,
 *   so it runs before anything is created.
 * - the `complete` flag asks whether the request's inputs fully resolved. It can
 *   only be answered after materialization, and aborts before the paid call.
 *
 * State: `submitting` is this hook's own — one user-initiated request in flight.
 * `generating` is *not*; it is derived from `painting.generationStatus` and can be
 * set by a run this component never started (a resumed generation rehydrates it
 * from the cache mirror). Both compose into the guard, and both are forwarded so
 * the UI can disable a send without owning either.
 *
 * `cancel(paintingId)` keeps the original signature so list-side flows
 * (e.g. cancel-before-delete) can target a specific painting.
 */
export function usePaintingGenerationSubmit({
  painting,
  onPaintingChange,
  ensureCurrentCatalog
}: UsePaintingGenerationSubmitInput) {
  const { validateBeforeGenerate } = usePaintingGenerationGuard({
    painting,
    ensureCurrentCatalog
  })
  const { generate, cancel, generating } = usePaintingGeneration({
    painting,
    onPaintingChange
  })

  // Ref is the re-entrancy source of truth (it blocks a second call in the same
  // tick, before any state-driven disable has re-rendered); the state mirrors it
  // for the UI.
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    async (materialize: MaterializeInputs) => {
      if (generating || submittingRef.current) return
      submittingRef.current = true
      setSubmitting(true)
      try {
        const guardResult = await validateBeforeGenerate()
        if (!guardResult.ok) {
          void presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error, painting.providerId)
          return
        }
        const { entries, complete } = await materialize()
        // An incomplete set must never reach generation — the composer has already
        // dropped the failed chip and told the user; generating anyway would spend
        // the request on a silently smaller input set.
        if (!complete) return
        await generate(entries)
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    },
    [generate, generating, painting.providerId, validateBeforeGenerate]
  )

  return { generating, submitting, submit, cancel }
}
