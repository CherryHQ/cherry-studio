import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { MessageVirtualListContainer } from '../MessageVirtualListContainer'

it('keeps nested scrollers interactive without losing virtua geometry, children or the DOM ref', () => {
  let ref: HTMLDivElement | null = null
  const style = Object.freeze({
    contain: 'size style',
    position: 'relative' as const,
    pointerEvents: 'none' as const,
    height: '3148px'
  })
  render(
    <MessageVirtualListContainer
      ref={(element) => {
        ref = element
      }}
      style={style}>
      <span>Nested scroller content</span>
    </MessageVirtualListContainer>
  )

  const element = screen.getByText('Nested scroller content').parentElement
  expect(ref).toBe(element)
  // #24842: suppressing pointer events here makes every nested scroller unreachable during scrolling.
  expect(element?.style.pointerEvents).toBe('')
  expect(element).toHaveStyle({ contain: 'size style', position: 'relative', height: '3148px' })
  expect(style.pointerEvents).toBe('none')
})
