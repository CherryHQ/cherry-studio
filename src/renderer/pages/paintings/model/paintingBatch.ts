import type { FileMetadata } from '@renderer/types/file'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { CreatePaintingDto, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { FileEntry } from '@shared/data/types/file'
import type { PaintingMode } from '@shared/data/types/painting'

import { paintingDataToCreateDto } from './mappers/paintingDataToCreateDto'
import type { GenerateInput } from './types/generateInput'
import type { PaintingData } from './types/paintingData'
import type { PaintingProviderRuntime } from './types/paintingProviderRuntime'

export interface PaintingTarget {
  providerId: string
  modelId: string
}

export function isSamePaintingTarget(a: PaintingTarget, b: PaintingTarget): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId
}

export interface PaintingBatchRequest {
  batchId: string
  target: PaintingTarget
  prompt: string
  mode: PaintingMode
  /** Reference images this target actually receives. */
  inputFiles: FileEntry[]
  /** Set when references were attached but this target's model cannot use them. */
  referencesIgnored: boolean
  params: Record<string, unknown>
}

export type PaintingBatchStatus = 'pending' | 'generating' | 'done' | 'failed' | 'canceled'

export interface PaintingBatchColumn {
  key: string
  label: string
  paintingId: string | null
  status: PaintingBatchStatus
  files: FileMetadata[]
  error: string | null
  request: PaintingBatchRequest
}

interface PlanPaintingBatchInput {
  batchId: string
  targets: PaintingTarget[]
  /** The target the draft is authored for. Only its parameters are shared with the draft. */
  primary: PaintingTarget
  prompt: string
  mode: PaintingMode
  inputFiles: FileEntry[]
  draftParams: Record<string, unknown>
  acceptsImageInput: (target: PaintingTarget) => boolean
}

/**
 * One request per target, sharing the prompt. Draft parameters belong to the
 * primary model only; every other target starts from its own defaults.
 */
export function planPaintingBatch(input: PlanPaintingBatchInput): PaintingBatchRequest[] {
  return input.targets.map((target) => {
    const referencesIgnored = input.inputFiles.length > 0 && !input.acceptsImageInput(target)
    return {
      batchId: input.batchId,
      target,
      prompt: input.prompt,
      mode: input.mode,
      inputFiles: referencesIgnored ? [] : input.inputFiles,
      referencesIgnored,
      params: isSamePaintingTarget(target, input.primary) ? { ...input.draftParams } : {}
    }
  })
}

export interface PaintingBatchDeps {
  loadProvider: (providerId: string) => Promise<PaintingProviderRuntime>
  createPainting: (dto: CreatePaintingDto) => Promise<unknown>
  updatePainting: (id: string, dto: UpdatePaintingDto) => Promise<unknown>
  generate: (input: GenerateInput) => Promise<FileMetadata[]>
}

/**
 * Runs one target as its own painting row. Throws on provider or generation
 * failure, and on abort. A failure stays with this target and never reaches
 * the others.
 */
export async function runPaintingBatchRequest(
  request: PaintingBatchRequest,
  paintingId: string,
  controller: AbortController,
  deps: PaintingBatchDeps
): Promise<FileMetadata[]> {
  const provider = await deps.loadProvider(request.target.providerId)
  if (!provider.isEnabled) {
    throw createPaintingGenerateError('PROVIDER_DISABLED')
  }
  controller.signal.throwIfAborted()

  const painting: PaintingData = {
    id: paintingId,
    providerId: request.target.providerId,
    model: request.target.modelId,
    mode: request.mode,
    prompt: request.prompt,
    files: [],
    inputFiles: request.inputFiles,
    params: request.params,
    batchId: request.batchId
  }
  await deps.createPainting(paintingDataToCreateDto(painting))
  const files = await deps.generate({ painting, provider, tab: 'default', abortController: controller })
  await deps.updatePainting(paintingId, {
    files: { output: files.map((file) => file.id), input: request.inputFiles.map((entry) => entry.id) }
  })
  return files
}
