import type { ComponentProps } from 'react'

import ConversationComposerStage from '../composer/ConversationComposerStage'
import { useOptionalShellState } from '../panes/Shell'

export type ConversationStageCenterProps = ComponentProps<typeof ConversationComposerStage>

export default function ConversationStageCenter(props: ConversationStageCenterProps) {
  const shellState = useOptionalShellState()

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col justify-between">
      <ConversationComposerStage {...props} composerElevated={props.composerElevated || shellState?.maximized} />
    </div>
  )
}
