import { useCallback, useMemo, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils/uuid'
import type { PaintingMode } from '@shared/data/types/painting'
import { isEditImageModel } from '@shared/utils/model'

import { normalizePaintingGenerateError, translatePaintingGenerateError } from '../errors/paintingGenerateError'
import { loadPaintingProviderRuntime } from '../model/loadPaintingProviderRuntime'
import {
  type PaintingBatchColumn,
  type PaintingBatchRequest,
  type PaintingTarget,
  planPaintingBatch,
  runPaintingBatchRequest
} from '../model/paintingBatch'
import { paintingGenerate } from '../model/paintingPipeline'
import type { GenerateInput } from '../model/types/generateInput'
import type { MaterializeInputs } from './usePaintingGenerationSubmit'

const logger = loggerService.withContext('paintings/usePaintingBatch')

interface SubmitPaintingBatchInput {
  targets: PaintingTarget[]
  primary: PaintingTarget
  prompt: string
  mode: PaintingMode
  draftParams: Record<string, unknown>
  materialize: MaterializeInputs
}

const isInFlight = (column: PaintingBatchColumn) => column.status === 'pending' || column.status === 'generating'

/**
 * Owns one multi-model send: a column per target, each running as its own
 * painting row. Columns are view state for the current send; the rows persist
 * and show up in history on their own.
 */
export function usePaintingBatch() {
  const { models } = useModels()
  const { createPainting, updatePainting, deletePainting } = usePaintings()
  const [columns, setColumns] = useState<PaintingBatchColumn[]>([])
  const [preparing, setPreparing] = useState(false)
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const controllersRef = useRef(new Map<string, AbortController>())

  const findModel = useCallback(
    (target: PaintingTarget) =>
      models.find((m) => m.providerId === target.providerId && m.apiModelId === target.modelId),
    [models]
  )

  const deps = useMemo(
    () => ({
      loadProvider: loadPaintingProviderRuntime,
      createPainting,
      updatePainting,
      generate: (input: GenerateInput) => paintingGenerate(input)
    }),
    [createPainting, updatePainting]
  )

  const patchColumn = useCallback((key: string, patch: Partial<PaintingBatchColumn>) => {
    setColumns((current) => current.map((column) => (column.key === key ? { ...column, ...patch } : column)))
  }, [])

  const runColumn = useCallback(
    async (key: string, request: PaintingBatchRequest) => {
      const paintingId = uuid()
      const controller = new AbortController()
      controllersRef.current.set(key, controller)
      patchColumn(key, { paintingId, status: 'generating', files: [], error: null })
      try {
        const files = await runPaintingBatchRequest(request, paintingId, controller, deps)
        patchColumn(key, { status: 'done', files })
      } catch (error) {
        if (controller.signal.aborted) {
          patchColumn(key, { status: 'canceled' })
        } else {
          const message = translatePaintingGenerateError(normalizePaintingGenerateError(error))
          logger.error('Batch column failed', error as Error, { target: request.target })
          patchColumn(key, { status: 'failed', error: message })
        }
      } finally {
        if (controllersRef.current.get(key) === controller) controllersRef.current.delete(key)
      }
    },
    [deps, patchColumn]
  )

  const submit = useCallback(
    async ({ targets, primary, prompt, mode, draftParams, materialize }: SubmitPaintingBatchInput) => {
      setPreparing(true)
      try {
        const { entries, complete } = await materialize()
        // Same rule as the single-model path: never spend requests on a partial input set.
        if (!complete) return
        const requests = planPaintingBatch({
          batchId: uuid(),
          targets,
          primary,
          prompt,
          mode,
          inputFiles: entries,
          draftParams,
          acceptsImageInput: (target) => {
            const model = findModel(target)
            return model ? isEditImageModel(model) : false
          }
        })
        const next = requests.map<PaintingBatchColumn>((request) => ({
          key: uuid(),
          label: findModel(request.target)?.name ?? request.target.modelId,
          paintingId: null,
          status: 'pending',
          files: [],
          error: null,
          request
        }))
        setColumns(next)
        for (const column of next) void runColumn(column.key, column.request)
      } finally {
        setPreparing(false)
      }
    },
    [findModel, runColumn]
  )

  const regenerate = useCallback(
    (key: string) => {
      const column = columnsRef.current.find((c) => c.key === key)
      if (!column || isInFlight(column)) return
      void runColumn(key, column.request)
    },
    [runColumn]
  )

  const cancel = useCallback((key: string) => {
    controllersRef.current.get(key)?.abort()
  }, [])

  const cancelAll = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort()
  }, [])

  const remove = useCallback(
    (key: string) => {
      const column = columnsRef.current.find((c) => c.key === key)
      controllersRef.current.get(key)?.abort()
      setColumns((current) => current.filter((c) => c.key !== key))
      if (column?.paintingId) {
        deletePainting(column.paintingId).catch((error: unknown) => {
          logger.warn('Failed to move batch column painting to trash', { paintingId: column.paintingId, error })
        })
      }
    },
    [deletePainting]
  )

  const dismiss = useCallback(() => setColumns([]), [])

  return {
    columns,
    preparing,
    running: columns.some(isInFlight),
    submit,
    regenerate,
    cancel,
    cancelAll,
    remove,
    dismiss
  }
}
