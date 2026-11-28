import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCommandHandler, useCommandOrigin, useCommandRuntime, useResolvedCommand } from '@renderer/hooks/command'
import type { CommandId } from '@shared/utils/command'

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandFocusScope } from '../CommandFocusScope'
import { CommandProvider } from '../CommandProvider'

vi.mock('@renderer/utils/platform', () => ({ platform: 'win32', isMac: false }))

function Providers({ children }: { children: ReactNode }) {
  return (
    <CommandContextKeyProvider>
      <CommandProvider>{children}</CommandProvider>
    </CommandContextKeyProvider>
  )
}

function Scope({
  name,
  tab = false,
  active = true,
  children
}: {
  name: string
  tab?: boolean
  active?: boolean
  children?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <CommandFocusScope rootRef={rootRef} kind={tab ? 'tab' : undefined} active={active}>
      <div ref={rootRef}>
        <input aria-label={`${name} input`} defaultValue="Draft to preserve" />
        {children}
      </div>
    </CommandFocusScope>
  )
}

function Owner({
  name,
  command = 'app.sidebar.open_1',
  enabled = true,
  accept = true
}: {
  name: string
  command?: CommandId
  enabled?: boolean
  accept?: boolean
}) {
  const [count, setCount] = useState(0)
  useCommandHandler(command, () => setCount((value) => value + 1), { enabled, shouldHandleKeyEvent: () => accept })
  return <output aria-label={name}>{count}</output>
}

function press(name?: string, search = false) {
  const event = new KeyboardEvent('keydown', {
    key: search ? 'F' : '1',
    code: search ? 'KeyF' : 'Digit1',
    ctrlKey: true,
    shiftKey: search,
    bubbles: true,
    cancelable: true
  })
  act(() => {
    const target = name ? screen.getByRole('textbox', { name: `${name} input` }) : window
    if (target instanceof HTMLElement) target.focus()
    target.dispatchEvent(event)
  })
  return event.defaultPrevented
}

beforeEach(() => MockUsePreferenceUtils.resetMocks())
afterEach(cleanup)

describe('declared command targets', () => {
  it('keeps navigation and window actions available from a nested composer without borrowing its disabled handler', () => {
    render(
      <Providers>
        <Owner name="search" command="app.search" />
        <Scope name="tab" tab>
          <Scope name="list">
            <Owner name="navigation" />
          </Scope>
          <Scope name="composer">
            <Owner name="disabled" enabled={false} />
          </Scope>
        </Scope>
      </Providers>
    )
    expect(press('composer')).toBe(true)
    expect(press('composer', true)).toBe(true)
    expect(screen.getByLabelText('navigation')).toHaveTextContent('1')
    expect(screen.getByLabelText('search')).toHaveTextContent('1')
    expect(screen.getByLabelText('disabled')).toHaveTextContent('0')
    expect(screen.getByLabelText('composer input')).toHaveValue('Draft to preserve')
  })

  it('preserves binding priority, skips unavailable targets and never retries after a selected predicate refuses', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.app.search', {
      binding: ['CommandOrControl', '1'],
      enabled: true
    })
    const tree = (enabled: boolean, accept = true) => (
      <Providers>
        <Owner name="search" command="app.search" enabled={enabled} accept={accept} />
        <Scope name="tab" tab>
          <Scope name="list">
            <Owner name="navigation" />
          </Scope>
          <Scope name="composer" />
        </Scope>
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(press('composer')).toBe(true)
    expect(screen.getByLabelText('search')).toHaveTextContent('1')
    expect(screen.getByLabelText('navigation')).toHaveTextContent('0')
    rerender(tree(false))
    expect(press('composer')).toBe(true)
    expect(screen.getByLabelText('navigation')).toHaveTextContent('1')
    rerender(tree(true, false))
    expect(press('composer')).toBe(false)
    expect(screen.getByLabelText('search')).toHaveTextContent('1')
    expect(screen.getByLabelText('navigation')).toHaveTextContent('1')
  })

  it.each([false, true])('refuses ambiguous navigation owners regardless of mount order %s', (reverse) => {
    const names = reverse ? ['second', 'first'] : ['first', 'second']
    const tree = (active: boolean) => (
      <Providers>
        <Scope name="tab" tab>
          {names.map((name) => (
            <Scope key={name} name={name} active={name === 'first' || active}>
              <Owner name={name} />
            </Scope>
          ))}
          <Scope name="composer" />
        </Scope>
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(press('composer')).toBe(false)
    expect(screen.getByLabelText('first')).toHaveTextContent('0')
    expect(screen.getByLabelText('second')).toHaveTextContent('0')
    rerender(tree(false))
    expect(press('composer')).toBe(true)
    expect(screen.getByLabelText('first')).toHaveTextContent('1')
    expect(screen.getByLabelText('second')).toHaveTextContent('0')
  })

  it('resolves the active tab outside its DOM and refuses hidden or transitioning origins', () => {
    const tree = (active: string) => (
      <Providers>
        <Owner name="standalone" />
        <Scope name="first" tab active={active === 'first'}>
          <Owner name="first" />
        </Scope>
        <Scope name="second" tab active={active === 'second'}>
          <Owner name="second" />
        </Scope>
      </Providers>
    )
    const { rerender } = render(tree('first'))
    expect(press()).toBe(true)
    expect(screen.getByLabelText('first')).toHaveTextContent('1')
    expect(press('second')).toBe(false)
    rerender(tree('second'))
    expect(press()).toBe(true)
    expect(screen.getByLabelText('second')).toHaveTextContent('1')
    rerender(tree('transition'))
    expect(press()).toBe(false)
    expect(screen.getByLabelText('standalone')).toHaveTextContent('0')
    expect(screen.getByLabelText('first')).toHaveTextContent('1')
    expect(screen.getByLabelText('second')).toHaveTextContent('1')
  })

  it('updates a sibling command control when its navigation owner mounts or unmounts', async () => {
    const user = userEvent.setup()
    function Controls() {
      const command = useResolvedCommand('app.sidebar.open_1')
      return (
        <button type="button" disabled={!command.enabled} onClick={command.execute}>
          Navigate
        </button>
      )
    }
    function Page() {
      const [show, setShow] = useState(false)
      return (
        <Scope name="tab" tab>
          <button type="button" onClick={() => setShow((value) => !value)}>
            Toggle list
          </button>
          {show && (
            <Scope name="list">
              <Owner name="navigation" />
            </Scope>
          )}
          <Scope name="composer">
            <Controls />
          </Scope>
        </Scope>
      )
    }
    render(
      <Providers>
        <Page />
      </Providers>
    )
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Toggle list' }))
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(screen.getByLabelText('navigation')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: 'Toggle list' }))
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeDisabled()
  })

  it('keeps explicit and captured calls bound to their tab when keyboard focus or active tab changes', async () => {
    const user = userEvent.setup()
    let captured: ReturnType<ReturnType<typeof useCommandOrigin>> | undefined
    function Controls() {
      const capture = useCommandOrigin()
      const runtime = useCommandRuntime()
      return (
        <>
          <button
            type="button"
            onClick={() => {
              captured = capture()
            }}>
            Capture
          </button>
          <button type="button" onClick={() => runtime.execute('app.sidebar.open_1')}>
            Execute bound
          </button>
        </>
      )
    }
    const tree = (active: string) => (
      <Providers>
        <Scope name="first" tab active={active === 'first'}>
          <Scope name="list">
            <Owner name="first" />
          </Scope>
          <Scope name="composer">
            <Controls />
          </Scope>
        </Scope>
        <Scope name="second" tab active={active === 'second'}>
          <Owner name="second" />
        </Scope>
      </Providers>
    )
    const { rerender } = render(tree('first'))
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Execute bound' }))
    expect(screen.getByLabelText('first')).toHaveTextContent('1')
    rerender(tree('second'))
    await user.click(screen.getByRole('button', { name: 'Execute bound' }))
    act(() => captured?.execute('app.sidebar.open_1'))
    expect(screen.getByLabelText('first')).toHaveTextContent('1')
    expect(screen.getByLabelText('second')).toHaveTextContent('0')
    expect(press('second')).toBe(true)
    expect(screen.getByLabelText('second')).toHaveTextContent('1')
  })
})
