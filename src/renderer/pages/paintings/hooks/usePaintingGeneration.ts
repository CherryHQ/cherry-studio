import { type Dispatch, type SetStateAction, useCallback } from 'react'

import { buildParamsSchema } from '@cherrystudio/provider-registry'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { ipcApi } from '@renderer/ipc'
import { uuid } from '@renderer/utils/uuid'
import { imageParameterDefaults } from '@shared/ai/imageGenerationConfig'
import type { FileEntry } from '@shared/data/types/file'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToCreateDto } from '../model/mappers/paintingDataToCreateDto'
import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/paintingAbortControllerStore'
import { paintingGenerate } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import { paintingGenerationStateToCache } from '../model/utils/paintingGenerationParams'
import { fileEntryToMetadata } from '../utils/fileEntryAdapter'
import { usePaintingProviderRuntime } from './usePaintingProviderRuntime'

const logger = loggerService.withContext('paintings/usePaintingGeneration')

interface UsePaintingGenerationInput {
  painting: PaintingData
  onPaintingChange: Dispatch<SetStateAction<PaintingData>>
}

export function usePaintingGeneration({ painting, onPaintingChange }: UsePaintingGenerationInput) {
  const { createPainting, updatePainting, selectPainting, refresh } = usePaintings()
  const { provider } = usePaintingProviderRuntime(painting.providerId)
  const [cachedGeneration] = useCache(`painting.generation.${painting.id}`)
  const generating = painting.generationStatus === 'running' || cachedGeneration?.status === 'running'
  const applyIfVisible = useCallback(
    (next: PaintingData) => {
      onPaintingChange((current) => (current.id === next.id ? next : current))
    },
    [onPaintingChange]
  )

  const generate = useCallback(
    async (attachments: FileEntry[], onPrepared: () => void, instruction = painting.prompt) => {
      let target: PaintingData | undefined
      let controller: AbortController | undefined
      try {
        const selected = painting.files.find((f) => f.id === painting.selectedFileId) ?? painting.files[0]
        const sourceId = selected?.id ?? painting.sourceFileId
        const inputFiles: FileEntry[] = sourceId
          ? [
              await dataApiService.get(`/files/entries/${encodeURIComponent(sourceId)}` as '/files/entries/:id'),
              ...attachments.filter((file) => file.id !== sourceId)
            ]
          : attachments
        let projectId = painting.persistedAt ? (painting.projectId ?? painting.id) : undefined
        let parentId = selected ? painting.id : (painting.parentId ?? undefined)
        if (!projectId && inputFiles.length) {
          const original: PaintingData = {
            ...painting,
            id: uuid(),
            prompt: '',
            operationPrompt: '',
            operation: 'import',
            files: await Promise.all(inputFiles.map(fileEntryToMetadata)),
            inputFiles: [],
            stepStatus: 'completed'
          }
          await createPainting(paintingDataToCreateDto(original))
          projectId = original.id
          parentId = original.id
        }
        const mode = inputFiles.length ? 'edit' : 'generate'
        let params = painting.params ?? {}
        try {
          const support = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
            params: { providerId: painting.providerId, modelId: painting.model ?? '' }
          })
          const selectedParams = params
          const parsed = buildParamsSchema(support ?? undefined, mode).safeParse(params)
          if (parsed.success) {
            params = imageParameterDefaults(support, mode, parsed.data)
            for (const key of ['aspectRatio', 'resolution', 'imageResolution', 'quality'] as const)
              if (selectedParams[key] !== undefined) params[key] = selectedParams[key]
            for (const key of ['aspectRatio', 'resolution', 'quality'] as const) {
              const definition = support?.modes?.[mode]?.supports?.[key]
              const fallback = definition && 'default' in definition ? definition.default : undefined
              if (params[key] === undefined && fallback !== undefined) params[key] = fallback
            }
          }
        } catch (error) {
          logger.warn('Failed to resolve image property defaults', { error })
        }
        target = {
          ...painting,
          params,
          id: uuid(),
          projectId,
          parentId,
          sourceFileId: inputFiles[0]?.id,
          inputFiles,
          files: [],
          selectedFileId: undefined,
          selectedStepId: undefined,
          prompt: instruction,
          operationPrompt: instruction,
          mode: inputFiles.length ? 'edit' : 'generate',
          operation: inputFiles.length ? 'edit' : 'generate',
          stepStatus: 'running',
          stepError: null,
          generationStatus: 'running',
          generationError: null
        }
        const saved = await createPainting(paintingDataToCreateDto(target))
        target.persistedAt = saved.createdAt
        target.stepNumber = saved.stepNumber
        await selectPainting(projectId ?? target.id, target.id)
        controller = new AbortController()
        registerPaintingAbortController(target.id, controller, projectId ?? target.id)
        cacheService.set(`painting.generation.${target.id}`, paintingGenerationStateToCache(target))
        const pendingPainting = target
        onPaintingChange((current) => (current.id === painting.id ? pendingPainting : current))
        onPrepared()
        const generatedFiles = await paintingGenerate({
          painting: target,
          provider,
          tab: 'default',
          abortController: controller
        })
        if (controller.signal.aborted) throw new DOMException('Canceled', 'AbortError')
        await updatePainting(target.id, {
          stepStatus: 'completed',
          stepError: null,
          files: { output: generatedFiles.map((f) => f.id), input: inputFiles.map((f) => f.id) }
        })
        cacheService.set(`painting.generation.${target.id}`, null)
        applyIfVisible({
          ...target,
          prompt: '',
          mode: 'edit',
          files: generatedFiles,
          inputFiles: [],
          selectedFileId: generatedFiles[0]?.id,
          stepStatus: 'completed',
          generationStatus: null
        })
        await refresh().catch((error) => logger.warn('Failed to refresh painting history', { error }))
      } catch (error) {
        const canceled = controller?.signal.aborted || (error instanceof Error && error.name === 'AbortError')
        if (target?.persistedAt) {
          const failed: PaintingData = {
            ...target,
            stepStatus: canceled ? 'canceled' : 'failed',
            stepError: canceled ? null : String(error),
            generationStatus: canceled ? 'canceled' : 'failed',
            generationError: canceled ? null : String(error)
          }
          cacheService.set(`painting.generation.${target.id}`, paintingGenerationStateToCache(failed))
          try {
            await updatePainting(target.id, { stepStatus: failed.stepStatus, stepError: failed.stepError })
          } catch (persistError) {
            logger.warn('Failed to persist terminal painting status', { error: persistError })
          }
          applyIfVisible(failed)
        }
        if (!canceled) presentPaintingGenerateError(error)
      } finally {
        if (target && controller) clearPaintingAbortController(target.id, controller)
      }
    },
    [painting, provider, createPainting, updatePainting, selectPainting, refresh, applyIfVisible, onPaintingChange]
  )

  const cancel = useCallback((id: string) => {
    abortPaintingGeneration(id)
    void ipcApi.request('ai.image.cancel_painting', { paintingId: id }).catch((error) => {
      logger.error('Failed to cancel painting generation', { paintingId: id, error })
      presentPaintingGenerateError(error)
    })
  }, [])
  return { generate, cancel, generating }
}
