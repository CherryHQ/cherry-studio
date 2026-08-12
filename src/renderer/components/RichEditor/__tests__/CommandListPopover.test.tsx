import { cleanup, render } from '@testing-library/react'
import { type RefObject, useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Command, CommandCategory } from '../command'
import CommandListPopover, { type CommandListPopoverRef } from '../CommandListPopover'

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  scrollToIndex: vi.fn()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
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

function createPopover(ref?: RefObject<CommandListPopoverRef | null>) {
  return (
    <CommandListPopover
      ref={ref}
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

function KeyboardPopoverHarness({ onReady }: { onReady: (value: CommandListPopoverRef | null) => void }) {
  const ref = useRef<CommandListPopoverRef>(null)

  useEffect(() => {
    onReady(ref.current)
  }, [onReady])

  return createPopover(ref)
}

function renderPopover() {
  return render(createPopover())
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
    expect(popover.style.background).toBe('var(--popover)')
  })

  it('lets Shift+Enter insert a newline while plain Enter selects the command', () => {
    const capturedRef: { current: CommandListPopoverRef | null } = { current: null }
    render(
      <KeyboardPopoverHarness
        onReady={(value) => {
          capturedRef.current = value
        }}
      />
    )

    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })
    expect(capturedRef.current?.onKeyDown(shiftEnter)).toBe(false)
    expect(shiftEnter.defaultPrevented).toBe(false)
    expect(mocks.command).not.toHaveBeenCalled()

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    expect(capturedRef.current?.onKeyDown(enter)).toBe(true)
    expect(enter.defaultPrevented).toBe(true)
    expect(mocks.command).toHaveBeenCalledWith({ id: 'paragraph', label: 'Text' })
  })
})
