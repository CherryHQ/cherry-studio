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

  it('provides the shared full-height center frame around the composer stage', () => {
    const { container } = render(
      <ConversationStageCenter placement="home" main={<div>messages</div>} composer={<div>composer</div>} />
    )

    expect(container.firstElementChild).toHaveClass('h-full', 'min-h-0', 'flex-1')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-placement', 'home')
  })

  it('elevates the composer when the right panel is maximized', () => {
    optionalPresentationState.value = { presentationMaximized: true }

    render(<ConversationStageCenter placement="docked" main={<div />} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'true')
  })

  it('hides the main message area when the right panel is maximized', () => {
    optionalPresentationState.value = { presentationMaximized: true }

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('stage-main')).toHaveTextContent('messages')
  })

  it('uses effective presentation state while maximized intent is temporarily hidden', () => {
    optionalPresentationState.value = { presentationMaximized: false }

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'false')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'true')
  })
})
