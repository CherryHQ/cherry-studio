/**
 * On success, strip any prior `data-translation` part from the target
 * message and append a fresh one with the accumulated text. Paused /
 * errored terminals are no-ops (discard-on-cancel).
 *
 * `dispatchToListeners` awaits serially, so the DB write completes
 * before `Ai_StreamDone` — the renderer can refresh on the standard
 * done IPC.
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
