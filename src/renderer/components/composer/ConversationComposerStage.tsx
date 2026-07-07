import type { ReactNode } from 'react'

import ComposerDockTransitionFrame, { type ComposerDockPlacement } from './ComposerDockTransitionFrame'
import ConversationHomeWelcome from './ConversationHomeWelcome'

export type ConversationComposerPlacement = ComposerDockPlacement

interface ConversationComposerStageProps {
  placement: ConversationComposerPlacement
  main: ReactNode
  composer: ReactNode
  homeWelcomeText?: string
  overlay?: ReactNode
  composerElevated?: boolean
  mainVisible?: boolean
}

export default function ConversationComposerStage({
  placement,
  main,
  composer,
  homeWelcomeText,
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
      homeHeader={!isDocked && homeWelcomeText ? <ConversationHomeWelcome text={homeWelcomeText} /> : undefined}
      mainVisible={resolvedMainVisible}
      overlay={overlay}
      composerElevated={composerElevated}
    />
  )
}
