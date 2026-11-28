import { type ComponentProps, useRef } from 'react'

import ConversationComposerStage from '@renderer/components/composer/ConversationComposerStage'

import { useRightPanelComposerElevated, useRightPanelPresentationMaximized } from '../panes/Shell'
import { ChatNarrowWidthHandles } from './ChatNarrowWidthHandles'

export type ConversationStageCenterProps = ComponentProps<typeof ConversationComposerStage>

export default function ConversationStageCenter(props: ConversationStageCenterProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const mainVisible = props.mainVisible ?? props.placement === 'docked'
  const paneMaximized = useRightPanelPresentationMaximized()
  const paneElevatesComposer = useRightPanelComposerElevated()

  return (
    <div ref={stageRef} className="relative flex h-full min-h-0 flex-1 flex-col justify-between">
      <ConversationComposerStage
        {...props}
        mainVisible={mainVisible && !paneMaximized}
        composerElevated={props.composerElevated || paneElevatesComposer}
      />
      <ChatNarrowWidthHandles stageRef={stageRef} visible={mainVisible && !paneMaximized && Boolean(props.composer)} />
    </div>
  )
}
