/**
 * Message-bound translation backend.
 *
 * Replaces the renderer's per-chunk `editMessage` → PATCH path with a single
 * write on stream success: strip any prior `data-translation` part from the
 * target message and append a fresh one carrying the accumulated translation
 * text. Paired with `PersistenceListener` and instantiated by
 * `TranslateService.open` only when the request carries a `messageId`.
 *
 * Ordering guarantee for the renderer: `TranslateService.open` registers this
 * backend's `PersistenceListener` BEFORE `WebContentsListener`, and
 * `AiStreamManager.dispatchToListeners` awaits each listener serially on
 * terminal events. The DB write therefore completes before `Ai_StreamDone`
 * fires, so the renderer can trust the standard done IPC as "safe to refresh"
 * without a dedicated persisted-event channel.
 *
 * Non-success terminals (paused/error) are intentionally a no-op — translation
 * is discard-on-cancel from the user's perspective, unlike chat which keeps
 * partial assistant replies on pause/error.
 */

import { messageService } from '@main/data/services/MessageService'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage, TextUIPart } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface TranslationBackendOptions {
  /** Target message whose `data.parts` will be patched with the new translation part. */
  messageId: string
  targetLanguage: TranslateLangCode
  sourceLanguage?: TranslateLangCode
}

export class TranslationBackend implements PersistenceBackend {
  readonly kind = 'translation'

  constructor(private readonly opts: TranslationBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    // Discard-on-cancel: paused/error stops never touch the message row.
    if (input.status !== 'success') return

    const accumulated = extractText(input.finalMessage)
    if (!accumulated) return

    const message = await messageService.getById(this.opts.messageId)
    const existingParts = message.data?.parts ?? []
    const baseParts = existingParts.filter((p) => p.type !== 'data-translation')

    const translationPart: CherryMessagePart = {
      type: 'data-translation',
      data: {
        content: accumulated,
        targetLanguage: this.opts.targetLanguage,
        ...(this.opts.sourceLanguage && { sourceLanguage: this.opts.sourceLanguage })
      }
    } as CherryMessagePart

    await messageService.update(this.opts.messageId, {
      data: { ...message.data, parts: [...baseParts, translationPart] }
    })
  }
}

function extractText(finalMessage: CherryUIMessage | undefined): string {
  if (!finalMessage?.parts) return ''
  return finalMessage.parts
    .filter((p): p is TextUIPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}
