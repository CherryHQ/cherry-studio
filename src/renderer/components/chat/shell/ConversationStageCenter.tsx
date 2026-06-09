import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

import { useOptionalShellState } from '../panes/Shell'

export type ConversationComposerPlacement = 'home' | 'docked'

export interface ConversationStageCenterProps {
  placement: ConversationComposerPlacement
  main: ReactNode
  composer: ReactNode
  homeWelcomeText?: string
  overlay?: ReactNode
  composerElevated?: boolean
}

export default function ConversationStageCenter(props: ConversationStageCenterProps) {
  const shellState = useOptionalShellState()
  const isDocked = props.placement === 'docked'
  const composerElevated = props.composerElevated || shellState?.maximized

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col justify-between">
      <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', !isDocked && 'pointer-events-none')}>
        {props.main}
      </div>
      <div
        data-conversation-composer-stage=""
        data-placement={props.placement}
        data-composer-elevated={composerElevated || undefined}
        className={cn(
          'absolute inset-x-0 w-full',
          composerElevated ? 'z-50' : 'z-10',
          isDocked
            ? 'bottom-0'
            : 'pointer-events-none top-0 bottom-0 flex items-center pb-[12vh] has-[.inputbar-container.expanded]:pb-0'
        )}>
        <div className="pointer-events-auto w-full">
          {!isDocked && props.homeWelcomeText ? (
            <div className="mb-6 flex justify-center">{props.homeWelcomeText}</div>
          ) : null}
          {props.composer}
        </div>
      </div>
      {props.overlay}
    </div>
  )
}
