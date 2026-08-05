import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationStageCenter from '../ConversationStageCenter'

const optionalPresentationState = vi.hoisted(() => ({
  value: undefined as { presentationMaximized: boolean } | undefined
}))

interface MockStageProps {
  placement: string
  main: ReactNode
  composer: ReactNode
  composerElevated?: boolean
  mainVisible?: boolean
}

vi.mock('@renderer/components/composer/ConversationComposerStage', () => ({
  default: ({ placement, main, composer, composerElevated, mainVisible }: MockStageProps) => (
    <div
      data-testid="conversation-stage"
      data-placement={placement}
      data-composer-elevated={String(Boolean(composerElevated))}
      data-main-visible={String(Boolean(mainVisible))}>
      <div data-testid="stage-main">{main}</div>
      <div data-testid="stage-composer">{composer}</div>
    </div>
  )
}))

vi.mock('../../panes/Shell', () => ({
  useOptionalRightPanelState: () => optionalPresentationState.value
}))

describe('ConversationStageCenter', () => {
  beforeEach(() => {
    optionalPresentationState.value = undefined
  })

  it('forwards stage content and maximized presentation state', () => {
    optionalPresentationState.value = { presentationMaximized: true }

    render(<ConversationStageCenter placement="home" main={<div>messages</div>} composer={<div>composer</div>} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('stage-main')).toHaveTextContent('messages')
    expect(screen.getByTestId('stage-composer')).toHaveTextContent('composer')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'true')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'false')
  })

  it('uses effective presentation state while maximized intent is temporarily hidden', () => {
    optionalPresentationState.value = { presentationMaximized: false }

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'false')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'true')
  })
})
