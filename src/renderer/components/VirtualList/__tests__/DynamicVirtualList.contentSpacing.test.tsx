import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { DynamicVirtualList, type DynamicVirtualListRef } from '..'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')

afterEach(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.restoreAllMocks()
})

function List() {
  const ref = useRef<DynamicVirtualListRef>(null)
  return (
    <>
      <button type="button" onClick={() => ref.current?.scrollToIndex(40, { align: 'start' })}>
        Go to item 40
      </button>
      <DynamicVirtualList
        ref={ref}
        list={Array.from({ length: 100 }, (_, index) => `Item ${index}`)}
        role="list"
        estimateSize={() => 50}
        itemContainerStyle={{ height: 50 }}
        contentProps={{ style: { paddingTop: 24 } }}
        overscan={0}>
        {(item) => <div role="listitem">{item}</div>}
      </DynamicVirtualList>
    </>
  )
}

// Losing the content offset makes navigation land 24px above the requested item.
it('includes content spacing when navigating to a virtual item', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5024)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.style.position === 'relative' ? 24 - (screen.queryByRole('list')?.scrollTop ?? 0) : 0
    return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 200, width: 400, height: 200, toJSON() {} }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0
      fireEvent.scroll(this)
    }
  })
  render(<List />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Go to item 40' }))

  expect(screen.getByRole('list').scrollTop).toBe(2024)
  expect(screen.getByText('Item 40')).toBeInTheDocument()
})
