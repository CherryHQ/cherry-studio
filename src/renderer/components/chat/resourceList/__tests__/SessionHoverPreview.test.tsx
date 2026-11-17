import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'

import {
  SessionHoverPreview,
  SessionHoverPreviewGroup,
  useSessionHoverPreviewContextMenu
} from '../SessionHoverPreview'

vi.mock('@cherrystudio/ui', async (original) => original())

function List({ enabled = true, first = true }: { enabled?: boolean; first?: boolean }) {
  return (
    <SessionHoverPreviewGroup enabled={enabled}>
      <div data-testid="list">
        {first && (
          <SessionHoverPreview id="a" content="Preview A">
            <span>Title A</span>
          </SessionHoverPreview>
        )}
        <SessionHoverPreview id="b" content="Preview B">
          <span>Title B</span>
        </SessionHoverPreview>
        <span>List gap</span>
      </div>
    </SessionHoverPreviewGroup>
  )
}

function MenuRow({ id }: { id: string }) {
  const onOpenChange = useSessionHoverPreviewContextMenu(id)
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger>
        <SessionHoverPreview id={id} content={`Preview ${id}`}>
          <span>{`Title ${id}`}</span>
        </SessionHoverPreview>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>{`Rename ${id}`}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
const pause = async (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

// user-event omits relatedTarget on pointerout; native transitions carry the next element.
function movePointer(from: Element, to: Element) {
  fireEvent(from, new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }))
  fireEvent(to, new MouseEvent('pointerover', { bubbles: true, relatedTarget: from }))
}

describe('Session hover previews', () => {
  it('waits initially, switches immediately without overlapping cards, and resets outside the list', async () => {
    const user = userEvent.setup()
    render(
      <>
        <List />
        <span>Outside</span>
      </>
    )
    await user.hover(screen.getByText('Title A'))
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await screen.findByText('Preview A')
    movePointer(screen.getByText('Title A'), screen.getByText('Title B'))
    expect(screen.getByText('Preview B')).toBeVisible()
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await pause(150)
    expect(screen.getByText('Preview B')).toBeVisible()
    movePointer(screen.getByText('Title B'), screen.getByText('List gap'))
    await waitFor(() => expect(screen.queryByText('Preview B')).not.toBeInTheDocument())
    movePointer(screen.getByText('List gap'), screen.getByText('Title A'))
    expect(screen.getByText('Preview A')).toBeVisible()
    movePointer(screen.getByText('Title A'), screen.getByText('Preview A'))
    await pause(150)
    expect(screen.getByText('Preview A')).toBeVisible()
    movePointer(screen.getByText('Preview A'), screen.getByText('Outside'))
    await waitFor(() => expect(screen.queryByText('Preview A')).not.toBeInTheDocument())
    movePointer(screen.getByText('Outside'), screen.getByText('Title B'))
    expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
    await screen.findByText('Preview B')
  })

  it.each(['body', 'editor'])(
    'cancels pending and open previews with Escape while %s has focus',
    async (focusTarget) => {
      const user = userEvent.setup()
      render(
        <>
          <List />
          <input aria-label="Message editor" onKeyDown={(event) => event.stopPropagation()} />
        </>
      )
      const focus = focusTarget === 'editor' ? screen.getByRole('textbox') : document.body
      if (focusTarget === 'editor') focus.focus()
      expect(focus).toHaveFocus()
      await user.hover(screen.getByText('Title A'))
      expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      await pause(650)
      expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
      expect(focus).toHaveFocus()

      movePointer(screen.getByText('Title A'), screen.getByText('Title B'))
      expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
      await screen.findByText('Preview B')
      movePointer(screen.getByText('Title B'), screen.getByText('Title A'))
      expect(screen.getByText('Preview A')).toBeVisible()
      await user.keyboard('{Escape}')
      expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
      movePointer(screen.getByText('Title A'), screen.getByText('Title B'))
      expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
      await screen.findByText('Preview B')
    }
  )

  it('cancels pending opens on scroll and clears previews on Escape or window blur', async () => {
    const user = userEvent.setup()
    render(<List />)
    await user.hover(screen.getByText('Title A'))
    fireEvent.scroll(screen.getByTestId('list'))
    await pause(650)
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await user.hover(screen.getByText('Title B'))
    await screen.findByText('Preview B')
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
    await user.hover(screen.getByText('Title A'))
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await screen.findByText('Preview A')
    fireEvent.blur(window)
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
  })

  it.each(['pending', 'title', 'preview'])(
    'suppresses the %s preview for the entire context menu lifetime and restores cold hover afterward',
    async (target) => {
      const user = userEvent.setup()
      render(
        <SessionHoverPreviewGroup>
          <MenuRow id="A" />
          <MenuRow id="B" />
          <span>List gap</span>
        </SessionHoverPreviewGroup>
      )
      const title = screen.getByText('Title A')
      await user.hover(title)
      if (target !== 'pending') await screen.findByText('Preview A')
      const source = target === 'preview' ? screen.getByText('Preview A') : title
      fireEvent.contextMenu(source)
      expect(screen.getByRole('menuitem', { name: 'Rename A' })).toBeVisible()
      await waitFor(() => expect(screen.queryByText('Preview A')).not.toBeInTheDocument())
      movePointer(title, screen.getByText('List gap'))
      movePointer(screen.getByText('List gap'), title)
      await pause(650)
      expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Rename A' })).toBeVisible()
      movePointer(title, screen.getByText('Title B'))
      await pause(650)
      expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      movePointer(screen.getByText('Title B'), screen.getByText('List gap'))
      movePointer(screen.getByText('List gap'), title)
      expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
      await screen.findByText('Preview A')
    }
  )
  it('releases preview suppression when the row owning an open menu unmounts', async () => {
    const user = userEvent.setup()
    function MenuList({ first = true }: { first?: boolean }) {
      return (
        <SessionHoverPreviewGroup>
          {first && <MenuRow id="A" />}
          <MenuRow id="B" />
          <span>List gap</span>
        </SessionHoverPreviewGroup>
      )
    }
    const view = render(<MenuList />)
    fireEvent.contextMenu(screen.getByText('Title A'))
    expect(screen.getByRole('menuitem', { name: 'Rename A' })).toBeVisible()
    view.rerender(<MenuList first={false} />)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await user.hover(screen.getByText('Title B'))
    expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
    await screen.findByText('Preview B')
  })
  it('removes a deleted row preview and resets a hidden list on return', async () => {
    const user = userEvent.setup()
    const view = render(<List />)
    await user.hover(screen.getByText('Title A'))
    await screen.findByText('Preview A')
    view.rerender(<List first={false} />)
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await user.hover(screen.getByText('Title B'))
    expect(screen.getByText('Preview B')).toBeVisible()
    view.rerender(<List first={false} enabled={false} />)
    expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
    view.rerender(<List enabled />)
    await user.hover(screen.getByText('Title A'))
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    await screen.findByText('Preview A')
  })

  it('resets an Activity-hidden list and does not warm another list', async () => {
    const user = userEvent.setup()
    const view = render(
      <Activity mode="visible">
        <List />
      </Activity>
    )
    await user.hover(screen.getByText('Title A'))
    await screen.findByText('Preview A')
    view.rerender(
      <Activity mode="hidden">
        <List />
      </Activity>
    )
    expect(screen.queryByText('Preview A')).not.toBeInTheDocument()
    view.rerender(
      <Activity mode="visible">
        <List />
      </Activity>
    )
    await user.hover(screen.getByText('Title B'))
    expect(screen.queryByText('Preview B')).not.toBeInTheDocument()
    await screen.findByText('Preview B')
    view.rerender(
      <>
        <Activity mode="visible">
          <List />
        </Activity>
        <SessionHoverPreviewGroup>
          <SessionHoverPreview id="c" content="Preview C">
            <span>Title C</span>
          </SessionHoverPreview>
        </SessionHoverPreviewGroup>
      </>
    )
    await user.hover(screen.getByText('Title C'))
    expect(screen.queryByText('Preview C')).not.toBeInTheDocument()
    await screen.findByText('Preview C')
  })
})
