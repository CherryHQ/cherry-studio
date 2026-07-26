import ConversationComposerStage from '@renderer/components/composer/ConversationComposerStage'
import type { ComponentProps } from 'react'

import { useOptionalRightPanelState } from '../panes/Shell'

export type ConversationStageCenterProps = ComponentProps<typeof ConversationComposerStage>

export default function ConversationStageCenter(props: ConversationStageCenterProps) {
  const presentationState = useOptionalRightPanelState()
  const mainVisible = props.mainVisible ?? props.placement === 'docked'
  const paneMaximized = presentationState?.presentationMaximized ?? false

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col justify-between">
      <ConversationComposerStage
        {...props}
        mainVisible={mainVisible && !paneMaximized}
        composerElevated={props.composerElevated || paneMaximized}
      />
    </div>
  )
}
