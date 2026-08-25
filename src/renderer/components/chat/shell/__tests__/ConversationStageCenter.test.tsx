import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationStageCenter from '../ConversationStageCenter'

const rightPanelPresentationMock = vi.hoisted(() => ({ elevated: false, maximized: false }))

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
  useRightPanelComposerElevated: () => rightPanelPresentationMock.elevated,
  useRightPanelPresentationMaximized: () => rightPanelPresentationMock.maximized
}))

describe('ConversationStageCenter', () => {
  beforeEach(() => {
    rightPanelPresentationMock.maximized = false
    rightPanelPresentationMock.elevated = false
  })

  it('forwards stage content and maximized presentation state', () => {
    rightPanelPresentationMock.maximized = true
    rightPanelPresentationMock.elevated = true

    render(<ConversationStageCenter placement="home" main={<div>messages</div>} composer={<div>composer</div>} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('stage-main')).toHaveTextContent('messages')
    expect(screen.getByTestId('stage-composer')).toHaveTextContent('composer')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'true')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'false')
  })

  it('keeps the composer lifted while a restore is still uncovering the chat', () => {
    // The restore drops the maximized presentation at the click but the pane covers the centre
    // until its phase ends: the chat comes back now, the composer may not sink behind the pane yet.
    rightPanelPresentationMock.maximized = false
    rightPanelPresentationMock.elevated = true

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'true')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'true')
  })

  it('uses effective presentation state while maximized intent is temporarily hidden', () => {
    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'false')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'true')
  })
})
