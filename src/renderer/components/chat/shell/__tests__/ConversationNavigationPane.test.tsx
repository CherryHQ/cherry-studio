import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConversationNavigationPane } from '../ConversationNavigationPane'
import { WindowFrameProvider } from '../WindowFrameContext'

describe('ConversationNavigationPane', () => {
  it.each(['embedded', 'window'] as const)('inherits its %s frame height from the sidebar', (mode) => {
    const { container } = render(
      <WindowFrameProvider value={{ mode }}>
        <ConversationNavigationPane>navigation</ConversationNavigationPane>
      </WindowFrameProvider>
    )
    const pane = container.firstElementChild

    // This shared flex contract prevents focus reveal from scrolling a clipped ancestor.
    expect(pane).toHaveClass('h-full', 'min-h-0')
    expect(pane?.className).not.toContain('100vh')
  })
})
