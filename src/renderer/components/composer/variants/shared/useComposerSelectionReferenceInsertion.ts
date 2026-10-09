import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import type { SelectionReference } from '@renderer/types/selectionReference'

import { useComposerLayerActive } from '../../ComposerContext'
import { COMPOSER_INPUT_MAX_LENGTH } from '../../composerDraft'
import type { ComposerDraftToken } from '../../tokens'

/** insertComposerTokenAtCursor appends one separator space after the token unless told not to. */
const TOKEN_SEPARATOR_LENGTH = 1

interface SelectionReferenceInsertionActions {
  getDraft: () => { text: string }
  insertToken: (token: ComposerDraftToken) => void
}

/**
 * Inserts a document selection reported by a FilePreview surface as a composer
 * chip. `EventEmitter` is a window-wide singleton, so the payload's `topicId`
 * must match this composer's — otherwise every mounted composer in the window
 * would swallow the same selection.
 *
 * Token insertion bypasses the composer's input-length guards, which sit on the typing and paste paths,
 * so this hook enforces COMPOSER_INPUT_MAX_LENGTH itself: a reference block carries the whole excerpt,
 * and `insertToken` appends a separator space on top of `promptText`. The check is deliberately
 * conservative — `insertContent` replaces the editor's selection, so with text selected the draft grows
 * by less than budgeted. It can refuse an insertion that would have fit, but never admits one that
 * overflows, and the selection length is not on the actions surface.
 */
export function useComposerSelectionReferenceInsertion<T extends SelectionReferenceInsertionActions>(
  actionsRef: RefObject<T>,
  topicId: string
): void {
  const { t } = useTranslation()
  const layerActive = useComposerLayerActive()

  const insertReference = useEffectEvent((reference: SelectionReference) => {
    const token = createSelectionReferenceToken(reference, t)
    // Token insertion skips the composer's typing and paste length guards, so the budget is enforced here;
    // insertToken adds a separator space on top of promptText.
    const insertionLength = (token.promptText?.length ?? 0) + TOKEN_SEPARATOR_LENGTH
    if (insertionLength > COMPOSER_INPUT_MAX_LENGTH - actionsRef.current.getDraft().text.length) {
      toast.error(t('chat.input.reference_panel.no_room_selection'))
      return
    }
    actionsRef.current.insertToken(token)
  })

  useEffect(() => {
    if (!layerActive) return
    return EventEmitter.on(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, (payload) => {
      const request = payload as { topicId?: string; reference?: SelectionReference } | undefined
      if (!request?.reference || request.topicId !== topicId) return
      insertReference(request.reference)
    })
  }, [insertReference, layerActive, topicId])
}
