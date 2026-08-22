import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import type { SelectionReference } from '@renderer/types/selectionReference'
import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { COMPOSER_INPUT_MAX_LENGTH } from '../../composerDraft'
import type { ComposerDraftToken } from '../../tokens'

interface SelectionReferenceInsertionActions {
  getDraft: () => { text: string }
  insertToken: (token: ComposerDraftToken) => void
}

/**
 * Inserts a document selection reported by a FilePreview surface as a composer
 * chip. `EventEmitter` is a window-wide singleton, so the payload's `topicId`
 * must match this composer's — otherwise every mounted composer in the window
 * would swallow the same selection.
 */
export function useComposerSelectionReferenceInsertion<T extends SelectionReferenceInsertionActions>(
  actionsRef: RefObject<T>,
  topicId: string
): void {
  const { t } = useTranslation()

  const insertReference = useEffectEvent((reference: SelectionReference) => {
    const token = createSelectionReferenceToken(reference)
    // Token insertion bypasses the composer's input-length guards, which sit on the typing and
    // paste paths. A reference block carries the whole excerpt, so one near the limit — or a few
    // in a row — would otherwise push the draft past COMPOSER_INPUT_MAX_LENGTH.
    const promptLength = token.promptText?.length ?? 0
    if (promptLength > COMPOSER_INPUT_MAX_LENGTH - actionsRef.current.getDraft().text.length) {
      toast.error(t('chat.input.reference_panel.no_room_selection'))
      return
    }
    actionsRef.current.insertToken(token)
  })

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, (payload) => {
      const request = payload as { topicId?: string; reference?: SelectionReference } | undefined
      if (!request?.reference || request.topicId !== topicId) return
      insertReference(request.reference)
    })
  }, [insertReference, topicId])
}
