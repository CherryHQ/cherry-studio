import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionContextMenu from '../SelectionContextMenu'

/**
 * Local override of the global `@cherrystudio/ui` mock so:
 *   1. `ContextMenu.onOpenChange` is wired to a right-click on the trigger
 *      child (otherwise the global mock never fires it, so internal state
 *      would never populate).
 *   2. `ContextMenuItem` exposes `role="menuitem"` and propagates `disabled`
 *      to a real `<button>`, so tests can use `getByRole` + `toBeDisabled`.
 *   3. `ContextMenuContent` is always rendered (no portal), so menu items
 *      are queryable without simulating Radix positioning.
 */
vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const OpenChangeContext = React.createContext<((open: boolean) => void) | null>(null)
  return {
    ContextMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
      <OpenChangeContext value={onOpenChange ?? null}>{children}</OpenChangeContext>
    ),
    ContextMenuTrigger: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
      const onOpenChange = React.use(OpenChangeContext)
      // Mirroring Radix `asChild`: forward our right-click handler onto the
      // caller's child. `Children.only` + `cloneElement` are inherent to the
      // asChild simulation; the React-19 warnings about them are accepted.
      // eslint-disable-next-line @eslint-react/no-children-only
      const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
      const props = {
        onContextMenu: (event: React.MouseEvent) => {
          event.preventDefault?.()
          onOpenChange?.(true)
        }
      }
      // eslint-disable-next-line @eslint-react/no-clone-element
      return asChild ? React.cloneElement(child, props) : <div {...props}>{children}</div>
    },
    ContextMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
    ContextMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children: ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          if (!disabled) onSelect?.()
        }}>
        {children}
      </button>
    )
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

/**
 * Provide a `window.getSelection` stub that returns a Selection backed by a
 * pre-built Range. Callers pass null to simulate "no selection at all".
 */
function mockSelection(range: Range | null, text: string): Selection | null {
  if (!range) return null
  return {
    rangeCount: 1,
    isCollapsed: range.collapsed,
    toString: () => text,
    getRangeAt: () => range
  } as unknown as Selection
}

function buildScroll(content: ReactNode) {
  return (
    <SelectionContextMenu>
      <section data-testid="scroll">{content}</section>
    </SelectionContextMenu>
  )
}

const askItem = () => screen.getByRole('menuitem', { name: 'chat.message.anchor.ask_here' })
const branchItem = () => screen.getByRole('menuitem', { name: 'chat.message.anchor.open_as_branch' })
const copyItem = () => screen.getByRole('menuitem', { name: 'common.copy' })
const quoteItem = () => screen.getByRole('menuitem', { name: 'chat.message.quote' })

beforeEach(() => {
  window.toast = { success: vi.fn(), error: vi.fn() } as unknown as typeof window.toast
  ;(window as unknown as { api: { quoteToMainWindow: ReturnType<typeof vi.fn> } }).api = {
    quoteToMainWindow: vi.fn().mockResolvedValue(undefined)
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('SelectionContextMenu', () => {
  describe('branch-anchor menu items', () => {
    it('enables both new items when the selection sits inside one MainTextBlock', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1" data-message-role="assistant">
            <p data-testid="t1">Hello world</p>
          </div>
        )
      )

      const text = document.getElementById('t1') ?? screen.getByTestId('t1')
      const range = document.createRange()
      range.selectNodeContents(text)
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Hello world'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(askItem()).not.toBeDisabled()
      expect(branchItem()).not.toBeDisabled()
      expect(copyItem()).not.toBeDisabled()
      expect(quoteItem()).not.toBeDisabled()
    })

    it('disables both new items for a cross-block selection while keeping Copy/Quote available', () => {
      render(
        buildScroll(
          <>
            <div data-message-id="m1" data-block-id="b1" data-message-role="assistant">
              <p data-testid="t1">First</p>
            </div>
            <div data-message-id="m1" data-block-id="b2" data-message-role="assistant">
              <p data-testid="t2">Second</p>
            </div>
          </>
        )
      )

      const range = document.createRange()
      range.setStart(screen.getByTestId('t1'), 0)
      range.setEnd(screen.getByTestId('t2'), screen.getByTestId('t2').childNodes.length)
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'First Second'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(askItem()).toBeDisabled()
      expect(branchItem()).toBeDisabled()
      // Copy / Quote behaviour is decoupled from block context — text is still selected.
      expect(copyItem()).not.toBeDisabled()
      expect(quoteItem()).not.toBeDisabled()
    })

    it('disables both new items when the selection has no data-block-id ancestor', () => {
      render(buildScroll(<p data-testid="loose">Untagged paragraph</p>))

      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('loose'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Untagged paragraph'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(askItem()).toBeDisabled()
      expect(branchItem()).toBeDisabled()
      expect(copyItem()).not.toBeDisabled()
      expect(quoteItem()).not.toBeDisabled()
    })

    it('disables both new items when the selection sits inside a user message', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1" data-message-role="user">
            <p data-testid="t">User prompt text</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'User prompt text'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(askItem()).toBeDisabled()
      expect(branchItem()).toBeDisabled()
      expect(copyItem()).not.toBeDisabled()
      expect(quoteItem()).not.toBeDisabled()
    })

    it('disables both new items when the wrapper has no data-message-role (e.g. error card)', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1">
            <p data-testid="t">Error card body</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Error card body'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(askItem()).toBeDisabled()
      expect(branchItem()).toBeDisabled()
      expect(copyItem()).not.toBeDisabled()
      expect(quoteItem()).not.toBeDisabled()
    })

    it('disables every action when there is no live selection', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1" data-message-role="assistant">
            <p>Body</p>
          </div>
        )
      )
      vi.spyOn(window, 'getSelection').mockReturnValue(null)

      fireEvent.contextMenu(screen.getByTestId('scroll'))

      expect(copyItem()).toBeDisabled()
      expect(quoteItem()).toBeDisabled()
      expect(askItem()).toBeDisabled()
      expect(branchItem()).toBeDisabled()
    })

    it('logs the captured anchor when "ask here" is clicked', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

      render(
        buildScroll(
          <div data-message-id="msg-7" data-block-id="blk-9" data-message-role="assistant">
            <p data-testid="t">Just this sentence</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Just this sentence'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))
      fireEvent.click(askItem())

      expect(debugSpy).toHaveBeenCalledWith(
        'branch-anchor: ask here',
        expect.objectContaining({
          messageId: 'msg-7',
          blockId: 'blk-9',
          selectedText: 'Just this sentence'
        })
      )
    })

    it('logs the captured anchor when "open as branch" is clicked', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

      render(
        buildScroll(
          <div data-message-id="msg-8" data-block-id="blk-10" data-message-role="assistant">
            <p data-testid="t">Fork from here</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Fork from here'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))
      fireEvent.click(branchItem())

      expect(debugSpy).toHaveBeenCalledWith(
        'branch-anchor: open as branch',
        expect.objectContaining({
          messageId: 'msg-8',
          blockId: 'blk-10',
          selectedText: 'Fork from here'
        })
      )
    })

    it('forwards the anchor to onOpenBranchPanel (host) instead of logging when the prop is supplied', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
      const onOpenBranchPanel = vi.fn()

      render(
        <SelectionContextMenu onOpenBranchPanel={onOpenBranchPanel}>
          <section data-testid="scroll">
            <div data-message-id="msg-h" data-block-id="blk-h" data-message-role="assistant">
              <p data-testid="t">Host receives this</p>
            </div>
          </section>
        </SelectionContextMenu>
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Host receives this'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))
      fireEvent.click(branchItem())

      expect(onOpenBranchPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-h',
          blockId: 'blk-h',
          selectedText: 'Host receives this'
        })
      )
      // Logger fallback path is bypassed when a host callback is present.
      expect(debugSpy).not.toHaveBeenCalledWith('branch-anchor: open as branch', expect.anything())
    })
  })

  describe('existing Copy / Quote behaviour is preserved', () => {
    it('Copy writes the selected text to the clipboard', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1" data-message-role="assistant">
            <p data-testid="t">Clipboard me</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Clipboard me'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))
      fireEvent.click(copyItem())

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Clipboard me')
    })

    it('Quote forwards the selected text to window.api.quoteToMainWindow', () => {
      render(
        buildScroll(
          <div data-message-id="m1" data-block-id="b1" data-message-role="assistant">
            <p data-testid="t">Quote me</p>
          </div>
        )
      )
      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('t'))
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection(range, 'Quote me'))

      fireEvent.contextMenu(screen.getByTestId('scroll'))
      fireEvent.click(quoteItem())

      const api = (window as unknown as { api: { quoteToMainWindow: ReturnType<typeof vi.fn> } }).api
      expect(api.quoteToMainWindow).toHaveBeenCalledWith('Quote me')
    })
  })
})
