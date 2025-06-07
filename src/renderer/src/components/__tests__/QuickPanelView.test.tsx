import { configureStore } from '@reduxjs/toolkit'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickPanelListItem, QuickPanelProvider, QuickPanelView, useQuickPanel } from '../QuickPanel'

// Mock Redux store
const mockStore = configureStore({
  reducer: {
    settings: (state = { userTheme: { colorPrimary: '#1677ff' } }) => state
  }
})

function createList(length: number, prefix = 'Item', extra: Partial<QuickPanelListItem> = {}) {
  return Array.from({ length }, (_, i) => ({
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

// 用于测试 open 行为的组件
function OpenPanelOnMount({ list }: { list: QuickPanelListItem[] }) {
  const quickPanel = useQuickPanel()
  useEffect(() => {
    quickPanel.open({
      title: 'Test Panel',
      list,
      symbol: 'test',
      pageSize: PAGE_SIZE
    })
  }, [list, quickPanel])
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
    // 添加一个假的 .inputbar textarea 到 document.body
    const inputbar = document.createElement('div')
    inputbar.className = 'inputbar'
    const textarea = document.createElement('textarea')
    inputbar.appendChild(textarea)
    document.body.appendChild(inputbar)
  })

  afterEach(() => {
    const inputbar = document.querySelector('.inputbar')
    if (inputbar) inputbar.remove()
  })

  describe('rendering', () => {
    it('should render without crashing when wrapped in QuickPanelProvider', () => {
      render(wrapWithProviders(<QuickPanelView setInputText={vi.fn()} />))

      // 检查面板容器是否存在且初始不可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(false)
    })

    it('should render list after open', async () => {
      const list = createList(100)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      // 检查面板可见
      const panel = screen.getByTestId('quick-panel')
      expect(panel.classList.contains('visible')).toBe(true)
      // 检查第一个 item 是否渲染
      expect(screen.getByText('Item 1')).toBeInTheDocument()
    })
  })

  describe('focusing', () => {
    // 执行一系列按键，检查 focused item 是否正确
    async function runKeySequenceAndCheck(panel: HTMLElement, sequence: KeyStep[]) {
      const user = userEvent.setup()
      for (const { key, ctrlKey, expected } of sequence) {
        let keyString = ''
        if (ctrlKey) keyString += '{Control>}'
        keyString += key.length === 1 ? key : `{${key}}`
        if (ctrlKey) keyString += '{/Control}'
        await user.keyboard(keyString)

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

    it('should focus on the first item after panel open', () => {
      const list = createList(100)

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      // 检查第一个 item 是否有 focused
      const item1 = screen.getByText('Item 1')
      const focused = item1.closest('.focused')
      expect(focused).not.toBeNull()
      expect(item1).toBeInTheDocument()
    })

    it('should focus on the right item using ArrowUp, ArrowDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowUp', expected: 'Item 100' },
        { key: 'ArrowUp', expected: 'Item 99' },
        { key: 'ArrowDown', expected: 'Item 100' },
        { key: 'ArrowDown', expected: 'Item 1' }
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using PageUp, PageDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'PageUp', expected: 'Item 1' }, // 停留在顶部
        { key: 'ArrowUp', expected: 'Item 100' },
        { key: 'PageDown', expected: 'Item 100' }, // 停留在底部
        { key: 'PageUp', expected: `Item ${100 - PAGE_SIZE}` },
        { key: 'PageDown', expected: 'Item 100' }
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })

    it('should focus on the right item using Ctrl+ArrowUp, Ctrl+ArrowDown', async () => {
      const list = createList(100, 'Item')

      render(
        wrapWithProviders(
          <>
            <QuickPanelView setInputText={vi.fn()} />
            <OpenPanelOnMount list={list} />
          </>
        )
      )

      const keySequence = [
        { key: 'ArrowDown', ctrlKey: true, expected: `Item ${PAGE_SIZE + 1}` },
        { key: 'ArrowUp', ctrlKey: true, expected: 'Item 1' },
        { key: 'ArrowUp', ctrlKey: true, expected: 'Item 100' },
        { key: 'ArrowDown', ctrlKey: true, expected: 'Item 1' }
      ]

      await runKeySequenceAndCheck(screen.getByTestId('quick-panel'), keySequence)
    })
  })
})
