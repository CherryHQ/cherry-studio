// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import { ChatLayoutModeProvider, useChatLayoutMode } from '../ChatLayoutModeContext'

function Consumer() {
  const renderCount = useRef(0)
  renderCount.current += 1
  const { forceWideLayout, setForceWideLayout, setRailGutter } = useChatLayoutMode()

  return (
    <div data-testid="consumer">
      <output aria-label="render count">{renderCount.current}</output>
      <output aria-label="wide layout">{String(forceWideLayout)}</output>
      <button type="button" onClick={() => setRailGutter(12, 0.5)}>
        update rail
      </button>
      <button type="button" onClick={() => setForceWideLayout(true)}>
        force wide
      </button>
    </div>
  )
}

describe('ChatLayoutModeProvider', () => {
  it('updates inherited rail measurements without invalidating context consumers', () => {
    render(
      <ChatLayoutModeProvider>
        <Consumer />
      </ChatLayoutModeProvider>
    )

    const layoutOwner = screen.getByTestId('consumer').parentElement
    expect(screen.getByRole('status', { name: 'render count' })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'update rail' }))

    expect(layoutOwner?.style.getPropertyValue('--chat-rail-gutter')).toBe('12px')
    expect(layoutOwner?.style.getPropertyValue('--chat-rail-opacity')).toBe('0.5')
    expect(layoutOwner?.style.getPropertyValue('--chat-rail-rest-opacity')).toBe('0.35')
    expect(screen.getByRole('status', { name: 'render count' })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'force wide' }))
    expect(screen.getByRole('status', { name: 'wide layout' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'render count' })).toHaveTextContent('2')
  })
})
