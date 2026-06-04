import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Command, CommandCategory } from '../command'
import CommandListPopover from '../CommandListPopover'

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  scrollToIndex: vi.fn()
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  const DynamicVirtualList = ({ ref, list, children, scrollerStyle }: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: mocks.scrollToIndex }))

    return React.createElement(
      'div',
      { className: 'dynamic-virtual-list', style: scrollerStyle },
      list.map((item: Command, index: number) =>
        React.createElement(React.Fragment, { key: item.id }, children(item, index))
      )
    )
  }

  return { DynamicVirtualList }
})

const TestIcon = (({ size }: { size?: number | string }) => (
  <svg data-testid="command-icon" height={size} width={size} />
)) as Command['icon']

const items: Command[] = [
  {
    id: 'paragraph',
    title: 'Text',
    description: 'Start writing with plain text',
    category: CommandCategory.TEXT,
    icon: TestIcon,
    keywords: [],
    handler: vi.fn()
  }
]

function renderPopover() {
  return render(
    <CommandListPopover
      editor={{} as any}
      range={{ from: 0, to: 1 }}
      query=""
      text="/"
      items={items}
      command={mocks.command}
      decorationNode={document.createElement('span')}
      clientRect={() => null}
    />
  )
}

describe('CommandListPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('uses the design-system popover surface token for its background', () => {
    const { container } = renderPopover()

    const popover = container.querySelector('.command-list-popover') as HTMLElement
    expect(popover.style.background).toBe('var(--color-popover)')
  })
})
