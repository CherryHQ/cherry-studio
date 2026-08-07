import type { ReactNode } from 'react'

import ComposerDockTransitionFrame, { type ComposerDockPlacement } from './ComposerDockTransitionFrame'

export type ConversationComposerPlacement = ComposerDockPlacement

interface ConversationComposerStageProps {
  placement: ConversationComposerPlacement
  main: ReactNode
  composer: ReactNode
  overlay?: ReactNode
  composerElevated?: boolean
  mainVisible?: boolean
}

export default function ConversationComposerStage({
  placement,
  main,
  composer,
  overlay,
  composerElevated,
  mainVisible
}: ConversationComposerStageProps) {
  const isDocked = placement === 'docked'
  const resolvedMainVisible = mainVisible ?? isDocked

  return (
    <ComposerDockTransitionFrame
      placement={placement}
      main={main}
      composer={composer}
      mainVisible={resolvedMainVisible}
      overlay={overlay}
      composerElevated={composerElevated}
    />
  )
}
