import { uuid } from '@renderer/utils/uuid'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { PaintingMode } from '@shared/data/types/painting'

import type { PaintingData } from './types/paintingData'

/**
 * The composer's own authoring state — deliberately **not** a `PaintingData`
 * record. It carries only what the user is composing
 * (prompt / model / params / inputFiles / mode), never record concerns
 * (id / output files / status / canvas placement / generation state).
 *
 * `sessionId` keys the composer's mount: it changes **only** when the draft is
 * replaced wholesale (new generation, retry, node op), **never** on a
 * model / prompt / param edit. That is what decouples the composer from the
 * painting — switching the model no longer remounts the composer or drops the
 * attached input images.
 *
 * `targetCardId` set = regenerate that existing card in place (retry);
 * undefined = fork a new card. It replaces the old
 * `hasOutput || !persistedAt` heuristic in the generation path.
 */
export interface ComposerDraft {
  sessionId: string
  providerId: string
  model?: string
  prompt: string
  params: Record<string, unknown>
  mode: PaintingMode
  inputFiles: FileEntry[]
  targetCardId?: string
}

/** A fresh, empty draft on the given provider — the "waiting to create" state. */
export function createDraft(providerId: string): ComposerDraft {
  return { sessionId: uuid(), providerId, prompt: '', params: {}, mode: 'generate', inputFiles: [] }
}

/**
 * Load a card's recipe into a draft that regenerates that same card in place
 * (retry). `targetCardId` points at the card; the snapshot (model / params /
 * prompt / mode / inputFiles) comes straight off the persisted record.
 */
export function cardToRetryDraft(card: PaintingData): ComposerDraft {
  return {
    sessionId: uuid(),
    providerId: card.providerId,
    model: card.model,
    prompt: card.prompt,
    params: card.params ?? {},
    mode: card.mode,
    inputFiles: card.inputFiles ?? [],
    targetCardId: card.id
  }
}

/**
 * Build a draft from a source card for a canvas toolbar action (edit /
 * regenerate). No `targetCardId` → a new card is forked; `mode` is the action's
 * mode and the source's outputs (already resolved to `FileEntry[]`) ride in as
 * inputs when the action uses the source image (edit). `inputFiles` is empty for
 * a plain regenerate, which reruns the same recipe from scratch.
 */
export function cardToDerivedDraft(source: PaintingData, mode: PaintingMode, inputFiles: FileEntry[]): ComposerDraft {
  return {
    sessionId: uuid(),
    providerId: source.providerId,
    model: source.model,
    prompt: source.prompt,
    params: source.params ?? {},
    mode,
    inputFiles
  }
}

/**
 * Add a card's image(s) into the *current* draft ("add to chat") — keep the
 * prompt / model / params / mode the user is already composing and just append
 * the new inputs, deduped by id. A fresh `sessionId` re-seeds the composer so the
 * added chip shows. No genuinely new file → the draft is returned unchanged.
 */
export function appendComposerInputFiles(draft: ComposerDraft, additions: FileEntry[]): ComposerDraft {
  const existing = new Set(draft.inputFiles.map((file) => file.id))
  const next = additions.filter((file) => !existing.has(file.id))
  if (next.length === 0) return draft
  return { ...draft, sessionId: uuid(), inputFiles: [...draft.inputFiles, ...next] }
}
