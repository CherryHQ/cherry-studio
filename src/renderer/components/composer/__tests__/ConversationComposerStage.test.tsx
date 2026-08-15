import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationComposerStage from '../ConversationComposerStage'

interface MockFrameProps {
  main: ReactNode
  composer: ReactNode
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
        <div data-testid="stage-composer">{props.composer}</div>
      </div>
    )
  }
}))

describe('ConversationComposerStage', () => {
  it('hides main content in home placement', () => {
    render(<ConversationComposerStage placement="home" main={<div>messages</div>} composer={<div>composer</div>} />)

    expect(frameProps.current?.mainVisible).toBe(false)
  })

  it('shows main content in docked placement', () => {
    render(<ConversationComposerStage placement="docked" main={<div>messages</div>} composer={<div>composer</div>} />)

    expect(frameProps.current?.mainVisible).toBe(true)
  })

  it('allows callers to hide main content in docked placement', () => {
    render(
      <ConversationComposerStage
        placement="docked"
        main={<div>messages</div>}
        composer={<div>composer</div>}
        mainVisible={false}
      />
    )

    expect(frameProps.current?.mainVisible).toBe(false)
  })
})
