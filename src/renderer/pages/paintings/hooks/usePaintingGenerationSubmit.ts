import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from 'react'

import i18n from '@renderer/i18n/resolver'
import type { FileEntry } from '@shared/data/types/file'
import type { Model } from '@shared/data/types/model'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { canEditPaintingModel, canGeneratePaintingModel } from '../model/utils/paintingModelOptions'
import { presentPaintingGenerationGuardFeedback } from '../utils/presentPaintingGenerationGuardFeedback'
import { usePaintingGeneration } from './usePaintingGeneration'
import { usePaintingGenerationGuard } from './usePaintingGenerationGuard'

/** Resolves the composer's draft attachments into the entries a request consumes. */
export type MaterializeInputs = () => Promise<{ entries: FileEntry[]; complete: boolean }>

interface UsePaintingGenerationSubmitInput {
  painting: PaintingData
  onPaintingChange: Dispatch<SetStateAction<PaintingData>>
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

/** Validates and prepares each painting independently before starting generation. */
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

  const pendingIdsRef = useRef(new Map<string, symbol>())
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const [preparingToken, setPreparingToken] = useState<symbol | null>(null)
  const submitting = pendingIds.has(painting.id)
  const preparing = preparingToken !== null

  const submit = useCallback(
    async (materialize: MaterializeInputs, instruction?: string) => {
      const id = painting.id
      if (generating || pendingIdsRef.current.has(id)) return
      const token = Symbol(id)
      pendingIdsRef.current.set(id, token)
      setPendingIds(new Set(pendingIdsRef.current.keys()))
      setPreparingToken(token)
      const finishPreparation = () => {
        if (pendingIdsRef.current.get(id) === token) {
          pendingIdsRef.current.delete(id)
          setPendingIds(new Set(pendingIdsRef.current.keys()))
        }
        setPreparingToken((current) => (current === token ? null : current))
      }
      try {
        const guardResult = await validateBeforeGenerate()
        if (!guardResult.ok) {
          void presentPaintingGenerationGuardFeedback(guardResult.reason, guardResult.error, painting.providerId)
          return
        }
        const { entries, complete } = await materialize()
        // Do not spend a request with partially materialized references.
        if (!complete) return
        const needsEdit = painting.files.length > 0 || !!painting.sourceFileId || entries.length > 0
        if (needsEdit) {
          const option = (await ensureCurrentCatalog()).find((item) => item.value === painting.model)
          if (!option?.raw || !canEditPaintingModel(option.raw as Model)) {
            presentPaintingGenerateError(new Error(i18n.t('paintings.steps.edit_unsupported')))
            return
          }
        }
        if (!needsEdit) {
          const option = (await ensureCurrentCatalog()).find((item) => item.value === painting.model)
          if (option?.raw && !canGeneratePaintingModel(option.raw as Model)) {
            presentPaintingGenerateError(new Error(i18n.t('paintings.steps.generate_unsupported')))
            return
          }
        }
        await generate(entries, finishPreparation, instruction)
      } catch (error) {
        presentPaintingGenerateError(error)
      } finally {
        finishPreparation()
      }
    },
    [generate, generating, painting, ensureCurrentCatalog, validateBeforeGenerate]
  )

  return { generating, submitting, preparing, submit, cancel }
}
