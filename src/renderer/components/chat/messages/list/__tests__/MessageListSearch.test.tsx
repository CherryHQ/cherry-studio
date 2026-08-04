// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { CherryMessagePart } from '@shared/data/types/message'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import { MessageListSearch } from '../MessageListSearch'

const commandMock = vi.hoisted(() => ({ handler: undefined as (() => void) | undefined }))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/ActionIconButton', () => ({
  default: ({ icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) => (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (_command: string, handler: () => void, options: { enabled: boolean }) => {
    commandMock.handler = options.enabled ? handler : undefined
  }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => true
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  commandMock.handler = undefined
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

function installCustomHighlightsMock() {
  const cssDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
  const highlightDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
  const highlights = {
    delete: vi.fn(),
    set: vi.fn()
  }

  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: Object.assign(Object.create(cssDescriptor?.value ?? null), { highlights })
  })
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    value: class HighlightMock {}
  })

  return {
    highlights,
    restore() {
      if (cssDescriptor) Object.defineProperty(globalThis, 'CSS', cssDescriptor)
      else Reflect.deleteProperty(globalThis, 'CSS')
      if (highlightDescriptor) Object.defineProperty(globalThis, 'Highlight', highlightDescriptor)
      else Reflect.deleteProperty(globalThis, 'Highlight')
    }
  }
}

describe('MessageListSearch', () => {
  it('labels icon controls and exposes filter pressed states', async () => {
    const user = userEvent.setup()
    render(
      <MessageListSearch
        messages={[]}
        partsByMessageId={{}}
        renderUserTextAsMarkdown={false}
        locateMessage={vi.fn()}
        scrollToRange={vi.fn()}
        getOuterScroller={() => null}
        scopeRef={{ current: null }}
      />
    )

    act(() => commandMock.handler?.())

    const includeUserButton = screen.getByRole('button', { name: 'button.includes_user_questions' })
    expect(includeUserButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'button.case_sensitive' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'button.whole_word' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'common.previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.close' })).toBeEnabled()

    await user.click(includeUserButton)
    expect(includeUserButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('locates an unmounted part once, then navigates its mounted matches directly', async () => {
    const user = userEvent.setup()
    const scope = document.createElement('div')
    document.body.appendChild(scope)

    const message: MessageListItem = {
      id: 'a1',
      role: 'assistant',
      status: 'success',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const partsByMessageId = {
      a1: [{ type: 'text', text: 'apple apple' } as CherryMessagePart]
    }
    const locateMessage = vi.fn()
    const scrollToRange = vi.fn()

    render(
      <MessageListSearch
        messages={[message]}
        partsByMessageId={partsByMessageId}
        renderUserTextAsMarkdown={false}
        locateMessage={locateMessage}
        scrollToRange={scrollToRange}
        getOuterScroller={() => scope}
        scopeRef={{ current: scope }}
      />
    )

    act(() => commandMock.handler?.())
    await user.type(screen.getByRole('textbox'), 'apple')
    const next = screen.getByRole('button', { name: 'common.next' })
    await waitFor(() => expect(next).toBeEnabled())

    await user.click(next)
    expect(locateMessage).toHaveBeenCalledTimes(1)
    expect(scrollToRange).not.toHaveBeenCalled()

    act(() => {
      const partElement = document.createElement('div')
      partElement.dataset.messagePartId = 'a1-part-0'
      partElement.textContent = 'apple apple'
      scope.appendChild(partElement)
    })
    await waitFor(() => expect(scrollToRange).toHaveBeenCalledTimes(1))

    await user.click(next)
    await waitFor(() => expect(scrollToRange).toHaveBeenCalledTimes(2))
    expect(locateMessage).toHaveBeenCalledTimes(1)

    scope.remove()
  })

  it('refreshes highlights only after exact navigation has visually settled', async () => {
    const customHighlights = installCustomHighlightsMock()
    const animationFrames: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        animationFrames.push(callback)
        return animationFrames.length
      })
    const cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    const scope = document.createElement('div')
    const partElement = document.createElement('div')
    partElement.dataset.messagePartId = 'a1-part-0'
    partElement.textContent = 'apple apple'
    scope.appendChild(partElement)
    document.body.appendChild(scope)

    const scrollToRange = vi.fn()
    const message: MessageListItem = {
      id: 'a1',
      role: 'assistant',
      status: 'success',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const view = render(
      <MessageListSearch
        messages={[message]}
        partsByMessageId={{ a1: [{ type: 'text', text: 'apple apple' } as CherryMessagePart] }}
        renderUserTextAsMarkdown={false}
        locateMessage={vi.fn()}
        scrollToRange={scrollToRange}
        getOuterScroller={() => scope}
        scopeRef={{ current: scope }}
      />
    )

    try {
      const user = userEvent.setup()
      act(() => commandMock.handler?.())
      await user.type(screen.getByRole('textbox'), 'apple')
      const next = screen.getByRole('button', { name: 'common.next' })
      await waitFor(() => expect(next).toBeEnabled())
      await waitFor(() => expect(customHighlights.highlights.set).toHaveBeenCalled())
      customHighlights.highlights.set.mockClear()

      await user.click(next)
      await waitFor(() => expect(scrollToRange).toHaveBeenCalledTimes(1))
      expect(customHighlights.highlights.set).not.toHaveBeenCalled()

      act(() => animationFrames.shift()?.(0))
      expect(customHighlights.highlights.set).not.toHaveBeenCalled()
      act(() => animationFrames.shift()?.(16))

      expect(customHighlights.highlights.set).toHaveBeenCalledWith('message-search-current', expect.anything())
    } finally {
      view.unmount()
      scope.remove()
      requestAnimationFrameSpy.mockRestore()
      cancelAnimationFrameSpy.mockRestore()
      customHighlights.restore()
    }
  })

  it('cancels pending navigation when its result disappears', async () => {
    const user = userEvent.setup()
    const scope = document.createElement('div')
    document.body.appendChild(scope)

    const message: MessageListItem = {
      id: 'a1',
      role: 'assistant',
      status: 'success',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const props = {
      messages: [message],
      renderUserTextAsMarkdown: false,
      locateMessage: vi.fn(),
      scrollToRange: vi.fn(),
      getOuterScroller: () => scope,
      scopeRef: { current: scope }
    }
    const view = render(
      <MessageListSearch
        {...props}
        partsByMessageId={{ a1: [{ type: 'text', text: 'apple apple' } as CherryMessagePart] }}
      />
    )

    act(() => commandMock.handler?.())
    await user.type(screen.getByRole('textbox'), 'apple')
    const next = screen.getByRole('button', { name: 'common.next' })
    await waitFor(() => expect(next).toBeEnabled())

    await user.click(next)
    view.rerender(
      <MessageListSearch
        {...props}
        partsByMessageId={{ a1: [{ type: 'text', text: 'banana' } as CherryMessagePart] }}
      />
    )
    view.rerender(
      <MessageListSearch
        {...props}
        partsByMessageId={{ a1: [{ type: 'text', text: 'apple apple' } as CherryMessagePart] }}
      />
    )
    act(() => {
      const partElement = document.createElement('div')
      partElement.dataset.messagePartId = 'a1-part-0'
      partElement.textContent = 'apple apple'
      scope.appendChild(partElement)
    })

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(props.scrollToRange).not.toHaveBeenCalled()
    scope.remove()
  })

  it('expands a collapsed user part before completing navigation', async () => {
    const user = userEvent.setup()
    const scope = document.createElement('div')
    const partElement = document.createElement('div')
    const preview = document.createElement('span')
    const toggle = document.createElement('button')
    partElement.dataset.messagePartId = 'u1-part-0'
    preview.textContent = 'preview only'
    toggle.dataset.userMessageContentToggle = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'true')
      preview.textContent = 'preview only hidden apple'
    })
    partElement.append(preview, toggle)
    scope.appendChild(partElement)
    document.body.appendChild(scope)

    const message: MessageListItem = {
      id: 'u1',
      role: 'user',
      status: 'success',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const scrollToRange = vi.fn()

    render(
      <MessageListSearch
        messages={[message]}
        partsByMessageId={{ u1: [{ type: 'text', text: 'preview only hidden apple' } as CherryMessagePart] }}
        renderUserTextAsMarkdown={false}
        locateMessage={vi.fn()}
        scrollToRange={scrollToRange}
        getOuterScroller={() => scope}
        scopeRef={{ current: scope }}
      />
    )

    act(() => commandMock.handler?.())
    await user.type(screen.getByRole('textbox'), 'apple')
    await user.click(screen.getByRole('button', { name: 'button.includes_user_questions' }))
    const next = screen.getByRole('button', { name: 'common.next' })
    await waitFor(() => expect(next).toBeEnabled())
    await user.click(next)

    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
    await waitFor(() => expect(scrollToRange).toHaveBeenCalledTimes(1))

    scope.remove()
  })
})
