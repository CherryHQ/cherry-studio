import '@testing-library/jest-dom/vitest'

import { createEvent, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CodeToolCard } from '../CodeToolCard'

describe('CodeToolCard', () => {
  it('prevents default scrolling when toggling pin with Space', () => {
    const onTogglePin = vi.fn()
    const { container } = render(
      <CodeToolCard
        icon={(props) => <svg {...props} />}
        title="Claude Code"
        onClick={vi.fn()}
        onTogglePin={onTogglePin}
      />
    )

    const pinToggle = container.querySelector('[role="button"][tabindex="0"]')
    expect(pinToggle).toBeInTheDocument()

    const event = createEvent.keyDown(pinToggle!, { key: ' ' })
    fireEvent(pinToggle!, event)

    expect(event.defaultPrevented).toBe(true)
    expect(onTogglePin).toHaveBeenCalledTimes(1)
  })
})
