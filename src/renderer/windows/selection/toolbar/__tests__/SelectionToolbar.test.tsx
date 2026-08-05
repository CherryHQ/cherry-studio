import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import SelectionToolbar from '../SelectionToolbar'

const mocks = vi.hoisted(() => ({
  actionItems: [
    { id: 'copy', name: 'Copy', enabled: true, isBuiltIn: true },
    {
      id: 'search',
      name: 'Search',
      enabled: true,
      isBuiltIn: true,
      searchEngine: 'Example|https://search.example/?q={{queryString}}'
    },
    { id: 'quote', name: 'Quote', enabled: true, isBuiltIn: true },
    { id: 'summary', name: 'Summary', enabled: true, isBuiltIn: true },
    { id: 'disabled', name: 'Disabled', enabled: false, isBuiltIn: false }
  ] as SelectionActionItem[],
  clearTimeoutTimer: vi.fn(),
  handlers: new Map<string, (payload: unknown) => void>(),
  ipcRequest: vi.fn(),
  quoteToMainWindow: vi.fn(),
  setTimeoutTimer: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.selection.compact') return [false]
    if (key === 'feature.selection.action_items') return [mocks.actionItems]
    return [undefined]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/components/selection/SelectionToolbarView', () => ({
  default: ({
    actionItems,
    handleAction
  }: {
    actionItems: SelectionActionItem[]
    handleAction: (action: SelectionActionItem) => void
  }) => (
    <div>
      {actionItems.map((action) => (
        <button key={action.id} type="button" onClick={() => handleAction(action)}>
          {action.name}
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer,
    clearTimeoutTimer: mocks.clearTimeoutTimer
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (channel: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(channel, handler)
  }
}))

function pushSelection(text: string, isFullscreen = false) {
  act(() => {
    mocks.handlers.get('selection.text_selected')?.({ text, isFullscreen })
  })
}

describe('SelectionToolbar actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.ipcRequest.mockResolvedValue(true)
    Object.assign(window, {
      api: {
        ...window.api,
        quoteToMainWindow: mocks.quoteToMainWindow
      }
    })
  })

  it('forwards fresh selection data and fullscreen state to default actions', () => {
    render(<SelectionToolbar />)
    mocks.ipcRequest.mockClear()
    pushSelection('selected text', true)

    fireEvent.click(screen.getByRole('button', { name: 'Summary' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.process_action', {
      actionItem: expect.objectContaining({ id: 'summary', selectedText: 'selected text' }),
      isFullScreen: true
    })
    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.hide_toolbar')
    expect(mocks.actionItems.find((action) => action.id === 'summary')?.selectedText).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Disabled' })).not.toBeInTheDocument()
  })

  it.each([
    ['https://example.com/path', 'https://example.com/path'],
    ['hello world', 'https://search.example/?q=hello%20world'],
    ['https://example.com/\nnext', 'https://search.example/?q=https%3A%2F%2Fexample.com%2F%0Anext']
  ])('routes search text %j to the safe external target', (selectedText, expectedUrl) => {
    render(<SelectionToolbar />)
    mocks.ipcRequest.mockClear()
    pushSelection(selectedText)

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_website', expectedUrl)
    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.hide_toolbar')
  })

  it('routes quote and copy through their dedicated bridges', () => {
    render(<SelectionToolbar />)
    mocks.ipcRequest.mockClear()
    pushSelection('bridge text')

    fireEvent.click(screen.getByRole('button', { name: 'Quote' }))
    expect(mocks.quoteToMainWindow).toHaveBeenCalledWith('bridge text')
    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.hide_toolbar')

    mocks.ipcRequest.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.write_to_clipboard', 'bridge text')
  })
})
