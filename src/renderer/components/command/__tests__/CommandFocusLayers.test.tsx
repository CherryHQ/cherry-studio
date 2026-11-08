import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ReactNode, useRef, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { useCommandHandler } from '@renderer/hooks/command'
import type { CommandHandlerOptions } from '@renderer/hooks/command'
import type { CommandId } from '@shared/utils/command'

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandFocusScope } from '../CommandFocusScope'
import { CommandProvider } from '../CommandProvider'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/utils/platform', () => ({ platform: 'win32' }))

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

function Counter({
  name,
  command = 'topic.create',
  options
}: {
  name: string
  command?: CommandId
  options?: CommandHandlerOptions
}) {
  const [count, setCount] = useState(0)
  useCommandHandler(command, () => setCount((value) => value + 1), options)
  return <output aria-label={`${name} actions`}>{count}</output>
}

function Surface({
  name,
  children,
  webviewFocused,
  active = true
}: {
  name: string
  children?: ReactNode
  webviewFocused?: boolean
  active?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <CommandFocusScope
      rootRef={rootRef}
      active={active}
      context={webviewFocused === undefined ? {} : { 'webview.focused': webviewFocused }}>
      <div ref={rootRef}>
        <button type="button">Focus {name}</button>
        <Counter name={name} />
        {children}
      </div>
    </CommandFocusScope>
  )
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <CommandContextKeyProvider>
      <CommandProvider>{children}</CommandProvider>
    </CommandContextKeyProvider>
  )
}

function pressShortcut(target: HTMLElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event.defaultPrevented
}

describe('command keyboard layers with real UI primitives', () => {
  beforeEach(() => MockUsePreferenceUtils.resetMocks())
  afterEach(cleanup)

  it('isolates nested dialog scopes, preserves allowed root commands and restores each owner on close', async () => {
    const user = userEvent.setup()
    render(
      <Providers>
        <Counter name="allowed root" command="app.search" options={{ allowInKeyboardLayer: true }} />
        <Counter name="blocked root" command="app.print" />
        <Surface name="background" webviewFocused>
          <Dialog>
            <DialogTrigger>Open dialog</DialogTrigger>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Scoped dialog</DialogTitle>
              <Surface name="dialog">
                <Counter name="dialog navigation" command="app.sidebar.open_1" />
                <Dialog>
                  <DialogTrigger>Open nested dialog</DialogTrigger>
                  <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Nested dialog</DialogTitle>
                    <button type="button">Nested focus</button>
                    <DialogClose>Close nested dialog</DialogClose>
                  </DialogContent>
                </Dialog>
              </Surface>
              <DialogClose>Close outer dialog</DialogClose>
            </DialogContent>
          </Dialog>
        </Surface>
      </Providers>
    )
    const background = screen.getByRole('button', { name: 'Focus background' })
    expect(pressShortcut(background)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = screen.getByRole('button', { name: 'Focus dialog' })

    expect(pressShortcut(background)).toBe(false)
    expect(pressShortcut(dialog)).toBe(true)
    expect(screen.getByLabelText('background actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('dialog actions')).toHaveTextContent('1')
    expect(pressShortcut(dialog, { key: '1', code: 'Digit1' })).toBe(true)
    expect(screen.getByLabelText('dialog navigation actions')).toHaveTextContent('1')
    expect(pressShortcut(dialog, { key: 'f', code: 'KeyF', shiftKey: true })).toBe(true)
    expect(screen.getByLabelText('allowed root actions')).toHaveTextContent('1')
    expect(pressShortcut(dialog, { key: 'p', code: 'KeyP' })).toBe(false)
    expect(screen.getByLabelText('blocked root actions')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'Open nested dialog' }))
    expect(pressShortcut(dialog)).toBe(false)
    expect(pressShortcut(background)).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Close nested dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nested dialog' })).toBeNull())

    expect(pressShortcut(dialog)).toBe(true)
    expect(screen.getByLabelText('background actions')).toHaveTextContent('1')
    expect(pressShortcut(background)).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Close outer dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scoped dialog' })).toBeNull())
    expect(pressShortcut(background)).toBe(true)
    expect(screen.getByLabelText('background actions')).toHaveTextContent('2')
  })

  it('does not inherit the invoking list handler through a dropdown portal and restores routing after close', async () => {
    const user = userEvent.setup()
    render(
      <Providers>
        <Surface name="list">
          <DropdownMenu>
            <DropdownMenuTrigger>Open resource menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Dismiss resource menu</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Surface>
      </Providers>
    )
    const list = screen.getByRole('button', { name: 'Focus list' })
    await user.click(screen.getByRole('button', { name: 'Open resource menu' }))
    const menuItem = screen.getByRole('menuitem', { name: 'Dismiss resource menu' })
    expect(pressShortcut(menuItem)).toBe(false)
    expect(pressShortcut(list)).toBe(false)
    expect(screen.getByLabelText('list actions')).toHaveTextContent('0')

    await user.click(menuItem)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(pressShortcut(list)).toBe(true)
    expect(screen.getByLabelText('list actions')).toHaveTextContent('1')
  })

  it('restores the innermost dialog command owner after an Activity hide/show', async () => {
    const user = userEvent.setup()
    const tree = (visible: boolean) => (
      <Providers>
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <Surface name="cached page" active={visible}>
            <Dialog defaultOpen>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>Retained outer dialog</DialogTitle>
                <Counter name="outer dialog" />
                <button type="button">Focus outer dialog</button>
                <Dialog>
                  <DialogTrigger>Open retained inner dialog</DialogTrigger>
                  <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Retained inner dialog</DialogTitle>
                    <Counter name="inner dialog" />
                    <button type="button">Focus inner dialog</button>
                    <DialogClose>Close retained inner dialog</DialogClose>
                  </DialogContent>
                </Dialog>
              </DialogContent>
            </Dialog>
          </Surface>
        </Activity>
        <Surface name="visible sibling" />
      </Providers>
    )
    const { rerender } = render(tree(true))
    await user.click(screen.getByRole('button', { name: 'Open retained inner dialog' }))
    const inner = screen.getByRole('button', { name: 'Focus inner dialog' })
    expect(pressShortcut(inner)).toBe(true)
    expect(screen.getByLabelText('inner dialog actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('outer dialog actions')).toHaveTextContent('0')

    rerender(tree(false))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Retained inner dialog' })).toBeNull())
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus visible sibling' }))).toBe(true)

    rerender(tree(true))
    await screen.findByText('Retained inner dialog')
    expect(pressShortcut(inner)).toBe(true)
    expect(screen.getByLabelText('inner dialog actions')).toHaveTextContent('2')
    expect(screen.getByLabelText('outer dialog actions')).toHaveTextContent('0')
  })

  it('preserves sibling dialog opening order across Activity effect replay', async () => {
    const tree = (visible: boolean, firstOpen: boolean) => (
      <Providers>
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <Surface name="sibling dialog page" active={visible}>
            <Dialog open={firstOpen}>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>First sibling dialog</DialogTitle>
                <Counter name="first sibling dialog" />
                <button type="button">Focus first sibling dialog</button>
              </DialogContent>
            </Dialog>
            <Dialog open>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>Second sibling dialog</DialogTitle>
                <Counter name="second sibling dialog" />
              </DialogContent>
            </Dialog>
          </Surface>
        </Activity>
      </Providers>
    )
    const { rerender } = render(tree(true, false))
    rerender(tree(true, true))
    const first = screen.getByRole('button', { name: 'Focus first sibling dialog' })
    expect(pressShortcut(first)).toBe(true)
    expect(screen.getByLabelText('first sibling dialog actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('second sibling dialog actions')).toHaveTextContent('0')

    rerender(tree(false, true))
    rerender(tree(true, true))
    await screen.findByText('First sibling dialog')
    expect(pressShortcut(first)).toBe(true)
    expect(screen.getByLabelText('first sibling dialog actions')).toHaveTextContent('2')
    expect(screen.getByLabelText('second sibling dialog actions')).toHaveTextContent('0')
  })

  it('releases a cached Activity dialog boundary while hidden and restores its retained scope when shown', async () => {
    const tree = (visible: boolean) => (
      <Providers>
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <Surface name="cached page" active={visible}>
            <Dialog defaultOpen>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>Cached dialog</DialogTitle>
                <Surface name="cached dialog" />
              </DialogContent>
            </Dialog>
          </Surface>
        </Activity>
        <Surface name="active sibling" />
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus cached dialog' }))).toBe(true)
    expect(screen.getByLabelText('cached dialog actions')).toHaveTextContent('1')
    const sibling = screen.getByRole('button', { name: 'Focus active sibling', hidden: true })
    expect(pressShortcut(sibling)).toBe(false)

    rerender(tree(false))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cached dialog' })).toBeNull())
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus active sibling' }))).toBe(true)
    expect(screen.getByLabelText('active sibling actions')).toHaveTextContent('1')

    rerender(tree(true))
    await screen.findByRole('dialog', { name: 'Cached dialog' })
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus cached dialog' }))).toBe(true)
    expect(screen.getByLabelText('cached dialog actions')).toHaveTextContent('2')
    expect(pressShortcut(sibling)).toBe(false)
    expect(screen.getByLabelText('active sibling actions')).toHaveTextContent('1')
  })
})
