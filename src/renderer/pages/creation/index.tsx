import type { CreationKind } from '@shared/data/types/creation'
import { type FC, useCallback, useState } from 'react'

import ImageCreationMode from '../paintings'
import type { CreationModelKindSelection, CreationModelSelection } from './CreationModelSelector'
import type { CreationData } from './types'
import VideoCreationMode from './video/VideoCreationMode'

/**
 * Unified Creation page. There is no Image | Video tab: the selected generation
 * model decides which form/artboard flow is shown.
 */
const CreationPage: FC = () => {
  const [kind, setKind] = useState<CreationKind>('image')
  const [handoffSelection, setHandoffSelection] = useState<
    { kind: CreationKind; selection: CreationModelSelection } | undefined
  >(undefined)
  const [handoffCreationItem, setHandoffCreationItem] = useState<CreationData | undefined>(undefined)

  const onModelKindSelect = useCallback((selection: CreationModelKindSelection) => {
    setHandoffCreationItem(undefined)
    setHandoffSelection({
      kind: selection.kind,
      selection: { providerId: selection.providerId, modelId: selection.modelId }
    })
    setKind(selection.kind)
  }, [])

  const onCreationKindSelect = useCallback((item: CreationData) => {
    setHandoffSelection(undefined)
    setHandoffCreationItem(item)
    setKind(item.kind)
  }, [])

  if (kind === 'video') {
    return (
      <VideoCreationMode
        initialSelection={handoffSelection?.kind === 'video' ? handoffSelection.selection : undefined}
        initialCreationItem={handoffCreationItem?.kind === 'video' ? handoffCreationItem : undefined}
        onModelKindSelect={onModelKindSelect}
        onCreationKindSelect={onCreationKindSelect}
      />
    )
  }

  return (
    <ImageCreationMode
      initialSelection={handoffSelection?.kind === 'image' ? handoffSelection.selection : undefined}
      initialCreationItem={handoffCreationItem?.kind === 'image' ? handoffCreationItem : undefined}
      onModelKindSelect={onModelKindSelect}
      onCreationKindSelect={onCreationKindSelect}
    />
  )
}

export default CreationPage
