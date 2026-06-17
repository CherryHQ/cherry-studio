import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationStageCenter from '../ConversationStageCenter'

const optionalShellState = vi.hoisted(() => ({
  value: undefined as { maximized: boolean } | undefined
}))

interface MockStageProps {
  placement: string
  main: ReactNode
  composer: ReactNode
  homeWelcomeText?: string
  composerElevated?: boolean
}

vi.mock('../../composer/ConversationComposerStage', () => ({
  default: ({ placement, main, composer, homeWelcomeText, composerElevated }: MockStageProps) => (
    <div
      data-testid="conversation-stage"
      data-placement={placement}
      data-welcome={homeWelcomeText}
      data-composer-elevated={String(Boolean(composerElevated))}>
      <div data-testid="stage-main">{main}</div>
      <div data-testid="stage-composer">{composer}</div>
    </div>
  )
}))

vi.mock('../../panes/Shell', () => ({
  useOptionalShellState: () => optionalShellState.value
}))

describe('ConversationStageCenter', () => {
  beforeEach(() => {
    optionalShellState.value = undefined
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
})
