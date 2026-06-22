import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationComposerStage from '../ConversationComposerStage'

interface MockFrameProps {
  main: ReactNode
  composer: ReactNode
  homeHeader?: ReactNode
  mainVisible?: boolean
}

const frameProps = vi.hoisted(() => ({
  current: null as MockFrameProps | null
}))

vi.mock('../ComposerDockTransitionFrame', () => ({
  default: (props: MockFrameProps) => {
    frameProps.current = props
    return (
      <div data-testid="stage-frame">
        <div data-testid="stage-main">{props.main}</div>
        <div data-testid="stage-home-header">{props.homeHeader}</div>
        <div data-testid="stage-composer">{props.composer}</div>
      </div>
    )
  }
}))

describe('ConversationComposerStage', () => {
  it('renders home welcome and hides main content in home placement', () => {
    render(
      <ConversationComposerStage
        placement="home"
        main={<div>messages</div>}
        composer={<div>composer</div>}
        homeWelcomeText="Welcome"
      />
    )

    expect(frameProps.current?.mainVisible).toBe(false)
    expect(screen.getByTestId('stage-home-header')).toHaveTextContent('Welcome')
  })

  it('keeps welcome out of docked placement and shows main content', () => {
    render(
      <ConversationComposerStage
        placement="docked"
        main={<div>messages</div>}
        composer={<div>composer</div>}
        homeWelcomeText="Welcome"
      />
    )

    expect(frameProps.current?.mainVisible).toBe(true)
    expect(screen.getByTestId('stage-home-header')).toBeEmptyDOMElement()
  })
})
