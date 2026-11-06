import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ComposerFileReference } from '@renderer/types/selectionReference'

import { useComposerLayerActive } from '../../ComposerContext'
import type { ComposerDraftToken } from '../../tokens'

interface SelectionReferenceInsertionActions {
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
  const layerActive = useComposerLayerActive()

  const insertReference = useEffectEvent((reference: ComposerFileReference) => {
    const token = createSelectionReferenceToken(reference, t)
    actionsRef.current.insertToken(token)
  })

  useEffect(() => {
    if (!layerActive) return
    return EventEmitter.on(EVENT_NAMES.INSERT_COMPOSER_SELECTION_REFERENCE, (payload) => {
      const request = payload as { topicId?: string; reference?: ComposerFileReference } | undefined
      if (!request?.reference || request.topicId !== topicId) return
      insertReference(request.reference)
    })
  }, [insertReference, layerActive, topicId])
}
