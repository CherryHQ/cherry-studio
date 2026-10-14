import type { ComponentProps } from 'react'

import ConversationComposerStage from '@renderer/components/composer/ConversationComposerStage'

import { useRightPanelComposerElevated, useRightPanelPresentationMaximized } from '../panes/Shell'

export type ConversationStageCenterProps = ComponentProps<typeof ConversationComposerStage>

export default function ConversationStageCenter(props: ConversationStageCenterProps) {
  const mainVisible = props.mainVisible ?? props.placement === 'docked'
  const paneMaximized = useRightPanelPresentationMaximized()
  const paneElevatesComposer = useRightPanelComposerElevated()

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col justify-between">
      <ConversationComposerStage
        {...props}
        mainVisible={mainVisible && !paneMaximized}
        composerElevated={props.composerElevated || paneElevatesComposer}
      />
    </div>
  )
}
