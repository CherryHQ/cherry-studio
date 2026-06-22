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
}

export default function ConversationComposerStage({
  placement,
  main,
  composer,
  homeWelcomeText,
  overlay,
  composerElevated
}: ConversationComposerStageProps) {
  const isDocked = placement === 'docked'

  return (
    <ComposerDockTransitionFrame
      placement={placement}
      main={main}
      composer={composer}
      homeHeader={!isDocked && homeWelcomeText ? <ConversationHomeWelcome text={homeWelcomeText} /> : undefined}
      mainVisible={isDocked}
      overlay={overlay}
      composerElevated={composerElevated}
    />
  )
}
