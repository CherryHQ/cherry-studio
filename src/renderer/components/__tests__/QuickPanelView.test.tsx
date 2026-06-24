import { configureStore } from '@reduxjs/toolkit'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useRef } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuickPanelInputAdapter, QuickPanelListItem, QuickPanelOpenOptions } from '../QuickPanel'
import { QuickPanelProvider, QuickPanelView, useQuickPanel } from '../QuickPanel'

// Mock the DynamicVirtualList component
vi.mock('@renderer/components/VirtualList', async (importOriginal) => {
  // oxlint-disable-next-line consistent-type-imports
  const mod = await importOriginal<typeof import('@renderer/components/VirtualList')>()
  return {
    ...mod,
    DynamicVirtualList: ({ ref, list, children, scrollerStyle }: any & { ref?: React.RefObject<any | null> }) => {
      // Expose a mock function for scrollToIndex
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: vi.fn(),
        scrollToOffset: vi.fn()
      }))

      // Render all items, not virtualized
      return (
        <div style={scrollerStyle}>
          {list.map((item: any, index: number) => (
            <div key={item.id || index}>{children(item, index)}</div>
          ))}
        </div>
      )
    }
  }
})

// Mock Redux store
const mockStore = configureStore({
  reducer: {
    settings: (state = { userTheme: { colorPrimary: '#1677ff' } }) => state
  }
})

function createList(length: number, prefix = 'Item', extra: Partial<QuickPanelListItem> = {}) {
  return Array.from({ length }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    label: `${prefix} ${i + 1}`,
    description: `${prefix} Description ${i + 1}`,
    icon: `${prefix} Icon ${i + 1}`,
    action: () => {},
    ...extra
  }))
}

type KeyStep = {
  key: string
  ctrlKey?: boolean
  expected: string | ((text: string) => boolean)
}

const PAGE_SIZE = 7

function createInputAdapter(initialText = '', initialCursor = initialText.length) {
  let text = initialText
  let cursor = initialCursor
  const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()

  const adapter: QuickPanelInputAdapter = {
    getText: () => text,
    getCursorOffset: () => cursor,
    insertText: vi.fn((insertedText: string) => {
      text = `${text.slice(0, cursor)}${insertedText}${text.slice(cursor)}`
      cursor += insertedText.length
      listeners.forEach((listener) => listener())
    }),
    deleteTriggerRange: vi.fn(({ from, to }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursor = cursor <= from ? cursor : Math.max(from, cursor - (to - from))
      listeners.forEach((listener) => listener())
    }),
    focus: vi.fn(),
    subscribeInput: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  return {
    adapter,
    setText: (nextText: string, nextCursor = nextText.length) => {
      text = nextText
      cursor = nextCursor
      listeners.forEach((listener) => listener())
    }
  }
}

// 用于测试 open 行为的组件
function OpenPanelOnMount({
  list,
  panelOptions,
  parentPanel,
  queryAnchor = 0,
  symbol = 'test',
  trackInputQuery,
  triggerInfo
}: {
  list: QuickPanelListItem[]
  panelOptions?: Partial<QuickPanelOpenOptions>
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  symbol?: string
  trackInputQuery?: boolean
  triggerInfo?: QuickPanelOpenOptions['triggerInfo']
}) {
  const quickPanel = useQuickPanel()
  const didOpenRef = useRef(false)
  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true

    quickPanel.open({
      title: 'Test Panel',
      list,
      symbol,
      pageSize: PAGE_SIZE,
      parentPanel,
      queryAnchor,
      trackInputQuery,
      triggerInfo: triggerInfo ?? { type: 'input', position: queryAnchor, originalText: '' },
      ...panelOptions
    })
  }, [list, panelOptions, parentPanel, queryAnchor, quickPanel, symbol, trackInputQuery, triggerInfo])
  return null
}

function OpenChildPanelWithParentOnMount() {
  const quickPanel = useQuickPanel()
  const didOpenRef = useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true

    quickPanel.open({
      title: 'Child Panel',
      list: createList(1, 'Child'),
      symbol: 'child',
      pageSize: PAGE_SIZE,
      queryAnchor: 0,
      parentPanel: {
        title: 'Slash Panel',
        list: createList(1, 'Root'),
        symbol: '/',
        pageSize: PAGE_SIZE,
        queryAnchor: 0
      }
    })
  }, [quickPanel])

  return null
}

function wrapWithProviders(children: React.ReactNode) {
  return (
    <Provider store={mockStore}>
      <QuickPanelProvider>{children}</QuickPanelProvider>
    </Provider>
  )
}

describe('QuickPanelView', () => {
  beforeEach(() => {
    // 添加一个假的 composer textarea 到 document.body
    const inputbar = document.createElement('div')
    inputbar.dataset.testid = 'composer-fixture'
    const textarea = document.createElement('textarea')
    textarea.dataset.testid = 'composer-textarea'
    inputbar.appendChild(textarea)
    document.body.appendChild(inputbar)
  })

  afterEach(() => {
    const inputbar = document.querySelector('[data-testid="composer-fixture"]')
    if (inputbar) inputbar.remove()
  })

  describe('rendering', () => {
    it('should render without crashing when wrapped in QuickPanelProvider', () => {
      render(wrapWithProviders(<QuickPanelView inputAdapter={createInputAdapter().adapter} />))

      // 检查面板容器是否存在且初始不可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(false)
    })

    it('should render list after open', async () => {
      const list = createList(100)
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item 1' }}
            />
          </>
        )
      )

      // 检查面板可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(true)
      // 检查第一个 item 是否渲染
      expect(screen.getByText('Item 1')).toBeInTheDocument()
    })

    it('uses a slightly narrower horizontal width than the inputbar stack', () => {
      const list = createList(1)
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item 3' }}
            />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      expect(panel).toHaveClass('right-2', 'left-2')
      expect(panel).not.toHaveClass('w-full')
      expect(panel).toHaveClass('-top-1')
      expect(panel.className).not.toContain('px-[35px]')
      expect(panel.className).not.toContain('top-px')
    })

    it('renders the panel body with drawer-like elevation and motion', () => {
      const list = createList(1)
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item 1' }}
            />
          </>
        )
      )

      const panelBody = screen.getByTestId('quick-panel-body')
      expect(panelBody).toHaveClass('rounded-xl', 'border', 'border-border/80', 'bg-popover', 'text-popover-foreground')
      expect(panelBody).toHaveClass(
        'translate-y-0',
        'scale-100',
        'opacity-100',
        'shadow-[0_18px_44px_rgba(15,23,42,0.16),0_4px_12px_rgba(15,23,42,0.10)]'
      )
      expect(panelBody.className).not.toContain('bg-background')
    })

    it('uses neutral selected item styling instead of theme-primary styling', () => {
      const list = createList(1, 'Selected', { isSelected: true })
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item 1' }}
            />
          </>
        )
      )

      const selectedRow = screen.getByText('Selected 1').closest('[data-id="Selected-1"]')
      expect(selectedRow).toHaveClass('bg-accent')
      expect(selectedRow?.className).not.toContain('primary')
    })

    it('filters from the composer input adapter instead of rendering an internal search input', async () => {
      const list = createList(3, 'Item')
      const input = createInputAdapter('/Item1')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              trackInputQuery
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item3' }}
            />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('Item 1')).toBeInTheDocument()

      input.setText('/Item2')
      await waitFor(() => expect(screen.getByText('Item 2')).toBeInTheDocument())
      expect(screen.queryByText('Item 1')).not.toBeInTheDocument()
      expect(input.adapter.focus).toHaveBeenCalled()
    })

    it('auto-selects the first composer-query match', async () => {
      const list = createList(3, 'Item')
      const input = createInputAdapter('/Item3')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              trackInputQuery
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item1' }}
            />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')

      expect(screen.getByText('Item 3')).toBeInTheDocument()
      expect(screen.queryByText('Item 1')).not.toBeInTheDocument()
      await waitFor(() => {
        const focused = panel.querySelectorAll('.focused')
        expect(focused.length).toBe(1)
        expect(focused[0].textContent).toContain('Item 3')
      })
    })

    it('closes when the input trigger slash is deleted', async () => {
      const list = createList(3, 'Item')
      const input = createInputAdapter('/Item1')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              trackInputQuery
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item1' }}
            />
          </>
        )
      )

      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

      input.setText('Item1')

      await waitFor(() => expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible'))
    })

    it('does not navigate back to the parent panel from a child panel', async () => {
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenChildPanelWithParentOnMount />
          </>
        )
      )

      expect(screen.getByText('Child 1')).toBeInTheDocument()

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'ArrowLeft', ctrlKey: true })

      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.queryByText('Root 1')).not.toBeInTheDocument()
      expect(screen.queryByText('settings.quickPanel.back')).not.toBeInTheDocument()
    })
  })

  describe('focusing', () => {
    // 执行一系列按键，检查 focused item 是否正确
    async function runKeySequenceAndCheck(panel: HTMLElement, sequence: KeyStep[]) {
      for (const { key, ctrlKey, expected } of sequence) {
        fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key, ctrlKey })
        fireEvent.keyUp(screen.getByTestId('quick-panel-body'), { key, ctrlKey: false })

        // 检查是否只有一个 focused item
        const focused = panel.querySelectorAll('.focused')
        expect(focused.length).toBe(1)
        // 检查 focused item 是否包含预期文本
        const text = focused[0].textContent || ''
        if (typeof expected === 'string') {
          expect(text).toContain(expected)
        } else {
          expect(expected(text)).toBe(true)
        }
      }
    }

    it('should focus on the first selectable item after panel open by default', () => {
      const list = createList(100)
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item 1' }}
            />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      const focused = panel.querySelectorAll('.focused')
      expect(focused.length).toBe(1)
      expect(focused[0].textContent).toContain('Item 1')
    })

    it('should focus on the right item using ArrowUp, ArrowDown', async () => {
      const list = createList(100, 'Item')
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowDown', expected: 'Item 2' },
        { key: 'ArrowUp', expected: 'Item 1' },
        { key: 'ArrowUp', expected: 'Item 100' },
        { key: 'ArrowDown', expected: 'Item 1' },
        { key: 'ArrowDown', expected: 'Item 2' }
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using PageUp, PageDown', async () => {
      const list = createList(100, 'Item')
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'PageDown', expected: `Item ${PAGE_SIZE + 1}` },
        { key: 'PageUp', expected: 'Item 1' }, // PageUp 会选中第一个
        { key: 'ArrowUp', expected: 'Item 100' }, // 从第一个按 ArrowUp 会到最后一个
        { key: 'PageDown', expected: 'Item 100' }, // 从最后一个按 PageDown 仍然是最后一个
        { key: 'PageUp', expected: `Item ${100 - PAGE_SIZE}` } // PageUp 会向上翻页，从索引99到92，对应Item 93
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using Ctrl+ArrowUp, Ctrl+ArrowDown', async () => {
      const list = createList(100, 'Item')
      const input = createInputAdapter()

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowDown', ctrlKey: true, expected: `Item ${PAGE_SIZE + 1}` },
        { key: 'ArrowDown', ctrlKey: true, expected: `Item ${PAGE_SIZE * 2 + 1}` },
        { key: 'ArrowUp', ctrlKey: true, expected: `Item ${PAGE_SIZE + 1}` },
        { key: 'ArrowUp', ctrlKey: true, expected: 'Item 1' },
        // 翻页采用统一环绕（与单步方向键一致）：在顶部再按 Ctrl+ArrowUp 会按一页（PAGE_SIZE 个位置）回绕，
        // 而非跳到最后一项。
        { key: 'ArrowUp', ctrlKey: true, expected: `Item ${100 - PAGE_SIZE + 1}` },
        { key: 'ArrowDown', ctrlKey: true, expected: 'Item 1' } // 再按 Ctrl+ArrowDown 前进一页回到顶部
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('consumes the composer query before executing a leaf item with Enter', () => {
      const action = vi.fn()
      const input = createInputAdapter('/Item1')
      const list = createList(1, 'Item', { action })

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="/"
              trackInputQuery
              triggerInfo={{ type: 'input', position: 0, originalText: '/Item1' }}
            />
          </>
        )
      )

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'Enter' })

      expect(input.adapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 6 })
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ action: 'enter', searchText: 'Item1' }))
    })

    it('keeps the root input panel when slash follows whitespace', () => {
      const input = createInputAdapter('hello /', 7)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={createList(1)}
              symbol="/"
              queryAnchor={6}
              triggerInfo={{ type: 'input', position: 6, originalText: '/' }}
            />
          </>
        )
      )

      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    })

    it('keeps the root input panel when slash is at the beginning of a line', () => {
      const input = createInputAdapter('hello\n/', 7)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={createList(1)}
              symbol="/"
              queryAnchor={6}
              triggerInfo={{ type: 'input', position: 6, originalText: '/' }}
            />
          </>
        )
      )

      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    })

    it('closes the root input panel when slash is attached to previous text', async () => {
      const input = createInputAdapter('hello/', 6)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={createList(1)}
              symbol="/"
              queryAnchor={5}
              trackInputQuery
              triggerInfo={{ type: 'input', position: 5, originalText: '/' }}
            />
          </>
        )
      )

      await waitFor(() => expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible'))
    })

    it('closes the root input panel when slash query contains whitespace', async () => {
      const input = createInputAdapter('hello /image', 12)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={createList(1)}
              symbol="/"
              queryAnchor={6}
              trackInputQuery
              triggerInfo={{ type: 'input', position: 6, originalText: '/image' }}
            />
          </>
        )
      )

      input.setText('hello /image prompt')

      await waitFor(() => expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible'))
    })

    it('closes the root input panel when cursor is not at the end of the slash query segment', async () => {
      const input = createInputAdapter('hello /imageTail', 12)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={createList(1)}
              symbol="/"
              queryAnchor={6}
              trackInputQuery
              triggerInfo={{ type: 'input', position: 6, originalText: '/image' }}
            />
          </>
        )
      )

      await waitFor(() => expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible'))
    })

    it('removes the trigger slash when opening a child panel without filtering the child panel', async () => {
      const input = createInputAdapter('/Child')
      const childAction = vi.fn()
      const rootItem: QuickPanelListItem = {
        label: 'Root',
        filterText: 'Root Child',
        icon: 'root',
        isMenu: true,
        action: ({ context, parentPanel, queryAnchor }) => {
          context.open({
            title: 'Child Panel',
            list: createList(1, 'Server', { action: childAction }),
            symbol: 'child',
            parentPanel,
            queryAnchor,
            triggerInfo: context.triggerInfo
          })
        }
      }

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={[rootItem]}
              symbol="/"
              triggerInfo={{ type: 'input', position: 0, originalText: '/Child' }}
            />
          </>
        )
      )

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'Enter' })

      expect(input.adapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 1 })
      await waitFor(() => expect(screen.getByText('Server 1')).toBeInTheDocument())

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'Enter' })

      expect(input.adapter.deleteTriggerRange).toHaveBeenLastCalledWith({ from: 0, to: 5 })
      expect(childAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'enter', searchText: '' }))
    })

    it('does not filter non-root multi-select panels from composer input changes', async () => {
      const input = createInputAdapter('/Alpha')
      const list = createList(2, 'Prompt')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="multi-select-panel"
              panelOptions={{ multiple: true }}
              triggerInfo={{ type: 'input', position: 0, originalText: '/Alpha' }}
            />
          </>
        )
      )

      expect(screen.getByText('Prompt 1')).toBeInTheDocument()
      expect(screen.getByText('Prompt 2')).toBeInTheDocument()

      input.setText('/No Match')

      await waitFor(() => expect(screen.getByText('Prompt 1')).toBeInTheDocument())
      expect(screen.getByText('Prompt 2')).toBeInTheDocument()
    })

    it('only consumes the composer query once while selecting multiple non-root items', async () => {
      const input = createInputAdapter('/Prompt')
      const secondAction = vi.fn()
      const list: QuickPanelListItem[] = [
        {
          id: 'prompt-1',
          label: 'Prompt 1',
          filterText: 'Prompt 1',
          icon: 'Prompt Icon 1',
          action: () => {
            queueMicrotask(() => input.setText('[Prompt 1] '))
          }
        },
        {
          id: 'prompt-2',
          label: 'Prompt 2',
          filterText: 'Prompt 2',
          icon: 'Prompt Icon 2',
          action: secondAction
        }
      ]

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              symbol="multi-select-panel"
              panelOptions={{ multiple: true }}
              triggerInfo={{ type: 'input', position: 0, originalText: '/Prompt' }}
            />
          </>
        )
      )

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'Enter' })

      await waitFor(() => expect(input.adapter.getText()).toBe('[Prompt 1] '))
      expect(input.adapter.deleteTriggerRange).toHaveBeenCalledTimes(1)
      expect(input.adapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 7 })

      fireEvent.click(screen.getByText('Prompt 2'))

      expect(secondAction).toHaveBeenCalled()
      expect(input.adapter.deleteTriggerRange).toHaveBeenCalledTimes(1)
      expect(input.adapter.getText()).toBe('[Prompt 1] ')
    })

    it('does not close a replacement panel opened by a leaf action', async () => {
      const input = createInputAdapter('/manual')
      const rootItem: QuickPanelListItem = {
        label: 'Manual',
        filterText: 'Manual',
        icon: 'manual',
        action: ({ context, parentPanel, queryAnchor }) => {
          context.open({
            title: 'Manual Panel',
            list: createList(1, 'Server'),
            symbol: 'mcp',
            parentPanel,
            queryAnchor,
            triggerInfo: context.triggerInfo,
            multiple: true
          })
        }
      }

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount list={[rootItem]} />
          </>
        )
      )

      fireEvent.keyDown(screen.getByTestId('quick-panel-body'), { key: 'Enter' })

      await waitFor(() => expect(screen.getByText('Server 1')).toBeInTheDocument())
      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    })

    it('updates multi-select rows by item id when rendered items are cloned', async () => {
      const input = createInputAdapter()
      const list: QuickPanelListItem[] = [
        { id: 'first', label: 'Duplicate', filterText: 'duplicate', icon: 'first icon' },
        { id: 'second', label: 'Duplicate', filterText: 'duplicate', icon: 'second icon' }
      ]

      render(
        wrapWithProviders(
          <>
            <QuickPanelView inputAdapter={input.adapter} />
            <OpenPanelOnMount
              list={list}
              panelOptions={{
                multiple: true,
                sortFn: (items) => items.map((item) => ({ ...item }))
              }}
            />
          </>
        )
      )

      const panel = screen.getByTestId('quick-panel')
      const getRow = (id: string) => panel.querySelector(`[data-id="${id}"]`)

      fireEvent.click(getRow('first')!)

      await waitFor(() => expect(getRow('first')).toHaveAttribute('data-selected'))
      expect(getRow('second')).not.toHaveAttribute('data-selected')
    })
  })
})
