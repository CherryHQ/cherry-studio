import type { CreatePaintingDto, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { ComposerDraft } from '../composerDraft'
import type { PaintingData } from '../types/paintingData'

function inputFileIds(inputFiles: ComposerDraft['inputFiles']): string[] {
  return inputFiles.map((entry) => entry.id)
}

/**
 * Draft → create DTO for a brand-new card (no output yet). The in-flight
 * `generating` state is transient and lives only in memory (`inflightCard`); it
 * is never persisted, so the row carries no status until the run reaches a
 * terminal outcome (`succeeded` / `failed` / `canceled`).
 */
export function draftToCreateDto(draft: ComposerDraft, id: string): CreatePaintingDto {
  return {
    id,
    providerId: draft.providerId,
    modelId: draft.model?.trim() ? draft.model : undefined,
    prompt: draft.prompt,
    files: { output: [], input: inputFileIds(draft.inputFiles) },
    mode: draft.mode,
    params: draft.params
  }
}

/**
 * Draft → update DTO for retrying an existing card in place (clears output,
 * re-runs). Status is intentionally left untouched: `generating` is never
 * persisted, and keeping the card's prior `failed`/`canceled` means an
 * interrupted retry stays retry-able. The terminal status is written when the
 * run finishes.
 */
export function draftToUpdateDto(draft: ComposerDraft): UpdatePaintingDto {
  return {
    providerId: draft.providerId,
    modelId: draft.model?.trim() ? draft.model : undefined,
    prompt: draft.prompt,
    files: { output: [], input: inputFileIds(draft.inputFiles) },
    mode: draft.mode,
    params: draft.params
  }
}

/**
 * Draft → create DTO for one output image of a finished generation: the recipe
 * plus exactly one output file, a `succeeded` status, and — for a multi-image
 * generation — the shared `groupId`. Position is left unset so the canvas
 * clusters group members.
 */
export function draftToOutputCreateDto(
  draft: ComposerDraft,
  id: string,
  fileId: string,
  groupId?: string
): CreatePaintingDto {
  return {
    id,
    providerId: draft.providerId,
    modelId: draft.model?.trim() ? draft.model : undefined,
    prompt: draft.prompt,
    files: { output: [fileId], input: inputFileIds(draft.inputFiles) },
    mode: draft.mode,
    params: draft.params,
    status: 'succeeded',
    groupId
  }
}

/**
 * The transient in-flight card built from a draft at generate time. Used both as
 * the optimistic canvas node (shown with a spinner until `refresh()` surfaces the
 * real record) and as the generation input (`paintingGenerate` reads
 * model / prompt / params / inputFiles / mode off it).
 */
export function draftToInflightCard(draft: ComposerDraft, id: string): PaintingData {
  return {
    id,
    providerId: draft.providerId,
    model: draft.model,
    mode: draft.mode,
    prompt: draft.prompt,
    params: draft.params,
    inputFiles: draft.inputFiles,
    files: [],
    status: 'generating',
    canvasX: null,
    canvasY: null,
    canvasW: null
  }
}
