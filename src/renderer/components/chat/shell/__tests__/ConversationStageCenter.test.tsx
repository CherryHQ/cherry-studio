import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationStageCenter from '../ConversationStageCenter'

const optionalShellState = vi.hoisted(() => ({
  value: undefined as { maximized: boolean } | undefined
}))
const optionalPresentationState = vi.hoisted(() => ({
  value: undefined as { presentationMaximized: boolean } | undefined
}))

interface MockStageProps {
  placement: string
  main: ReactNode
  composer: ReactNode
  homeWelcomeText?: string
  composerElevated?: boolean
  mainVisible?: boolean
}

vi.mock('@renderer/components/composer/ConversationComposerStage', () => ({
  default: ({ placement, main, composer, homeWelcomeText, composerElevated, mainVisible }: MockStageProps) => (
    <div
      data-testid="conversation-stage"
      data-placement={placement}
      data-welcome={homeWelcomeText}
      data-composer-elevated={String(Boolean(composerElevated))}
      data-main-visible={String(Boolean(mainVisible))}>
      <div data-testid="stage-main">{main}</div>
      <div data-testid="stage-composer">{composer}</div>
    </div>
  )
}))

vi.mock('../../panes/Shell', () => ({
  useOptionalRightPanelState: () => optionalPresentationState.value,
  useOptionalShellState: () => optionalShellState.value
}))

describe('ConversationStageCenter', () => {
  beforeEach(() => {
    optionalShellState.value = undefined
    optionalPresentationState.value = undefined
  })

  it('provides the shared full-height center frame around the composer stage', () => {
    const { container } = render(
      <ConversationStageCenter
        placement="home"
        main={<div>messages</div>}
        composer={<div>composer</div>}
        homeWelcomeText="Welcome"
      />
    )

    expect(container.firstElementChild).toHaveClass('h-full', 'min-h-0', 'flex-1')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-welcome', 'Welcome')
  })

  it('elevates the composer when an optional right pane shell is maximized', () => {
    optionalShellState.value = { maximized: true }

    render(<ConversationStageCenter placement="docked" main={<div />} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'true')
  })

  it('hides the main message area when an optional right pane shell is maximized', () => {
    optionalShellState.value = { maximized: true }

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('stage-main')).toHaveTextContent('messages')
  })

  it('uses effective presentation state while maximized intent is temporarily hidden', () => {
    optionalShellState.value = { maximized: true }
    optionalPresentationState.value = { presentationMaximized: false }

    render(<ConversationStageCenter placement="docked" main={<div>messages</div>} composer={<div />} />)

    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-composer-elevated', 'false')
    expect(screen.getByTestId('conversation-stage')).toHaveAttribute('data-main-visible', 'true')
  })
})
