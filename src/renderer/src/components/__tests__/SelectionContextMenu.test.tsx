import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockCommandContextMenuItem = {
  id: string
  enabled: boolean
  onSelect: () => void
}

type MockCommandContextMenuProps = {
  children: ReactNode
  location: string
  getExtraItems: () => MockCommandContextMenuItem[]
}

const { commandContextMenuMock, toastMock, writeTextMock, quoteToMainWindowMock } = vi.hoisted(() => ({
  commandContextMenuMock: vi.fn(({ children }: MockCommandContextMenuProps) => <div>{children}</div>),
  toastMock: {
    success: vi.fn(),
    error: vi.fn()
  },
  writeTextMock: vi.fn(),
  quoteToMainWindowMock: vi.fn()
}))

vi.mock('@renderer/commands', () => ({
  CommandContextMenu: commandContextMenuMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import SelectionContextMenu from '../SelectionContextMenu'

const selectText = (element: Element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('SelectionContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      toast: toastMock,
      api: {
        quoteToMainWindow: quoteToMainWindowMock
      }
    })
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    })
    writeTextMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    cleanup()
  })

  it('builds chat message context items from the current native selection', async () => {
    render(
      <SelectionContextMenu>
        <div>Selected message text</div>
      </SelectionContextMenu>
    )

    selectText(screen.getByText('Selected message text'))
    const props = commandContextMenuMock.mock.calls.at(-1)?.[0] as MockCommandContextMenuProps
    let items: MockCommandContextMenuItem[] = []
    act(() => {
      items = props.getExtraItems()
    })

    expect(props.location).toBe('chat.message.context')
    expect(items).toEqual([
      expect.objectContaining({ id: 'selection.copy', enabled: true }),
      expect.objectContaining({ id: 'selection.quote', enabled: true })
    ])

    items[0].onSelect()
    items[1].onSelect()

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('Selected message text')
      expect(toastMock.success).toHaveBeenCalledWith('message.copied')
      expect(quoteToMainWindowMock).toHaveBeenCalledWith('Selected message text')
    })
  })

  it('disables selection actions when there is no selected text', () => {
    render(
      <SelectionContextMenu>
        <div>No selection</div>
      </SelectionContextMenu>
    )

    const props = commandContextMenuMock.mock.calls.at(-1)?.[0] as MockCommandContextMenuProps
    let items: MockCommandContextMenuItem[] = []
    act(() => {
      items = props.getExtraItems()
    })

    expect(items).toEqual([
      expect.objectContaining({ id: 'selection.copy', enabled: false }),
      expect.objectContaining({ id: 'selection.quote', enabled: false })
    ])
  })
})
