import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen } from '@testing-library/react'
import { type ReactNode, use, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CommandFocusScopeContext,
  useCommandContextKey,
  useCommandContextReader,
  useCommandHandler
} from '@renderer/hooks/command'
import type { RendererCommandContextKey } from '@renderer/hooks/command'
import type { ContextValue } from '@shared/types/command'
import type { CommandId } from '@shared/utils/command'
import { evaluateContextExpr, parseContextExpr } from '@shared/utils/command'

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandFocusScope } from '../CommandFocusScope'
import { CommandProvider } from '../CommandProvider'

vi.mock('@renderer/utils/platform', () => ({ platform: 'win32' }))

function CommandCounter({
  name,
  command = 'topic.create',
  enabled = true
}: {
  name: string
  command?: CommandId
  enabled?: boolean
}) {
  const [count, setCount] = useState(0)
  useCommandHandler(command, () => setCount((value) => value + 1), { enabled })
  return <output aria-label={`${name} actions`}>{count}</output>
}

function Surface({
  name,
  active = true,
  enabled = true,
  command,
  context,
  children
}: {
  name: string
  active?: boolean
  enabled?: boolean
  command?: CommandId
  context?: Partial<Record<RendererCommandContextKey, ContextValue>>
  children?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <CommandFocusScope rootRef={rootRef} active={active} context={context}>
      <div ref={rootRef}>
        <button type="button">Focus {name}</button>
        <CommandCounter name={name} command={command} enabled={enabled} />
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

function LocalContext({ value = true }: { value?: boolean }) {
  useCommandContextKey('chat.active', value)
  return null
}

function ContextIndicator({ name }: { name: string }) {
  const context = useCommandContextReader()
  const active = evaluateContextExpr(parseContextExpr('chat.active'), context)
  return <output aria-label={`${name} chat context`}>{String(active)}</output>
}

function pressShortcut(target: HTMLElement, key = 'n', code = 'KeyN') {
  const event = new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true, cancelable: true })
  // Dispatch in the same turn as focus so routing cannot rely on a later effect.
  act(() => {
    target.focus()
    target.dispatchEvent(event)
  })
  return event.defaultPrevented
}

describe('CommandFocusScope', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(cleanup)

  it('settles a scope consumer that reports context to its parent and still publishes changed values', () => {
    function ContextReporter({ onContext }: { onContext: (value: Readonly<Record<string, ContextValue>>) => void }) {
      const scope = use(CommandFocusScopeContext)!
      const version = useSyncExternalStore(scope.subscribe, scope.getVersion)
      useLayoutEffect(() => onContext(scope.options.context()), [onContext, scope, version])
      return null
    }
    function ContextOwner({ active }: { active: boolean }) {
      const rootRef = useRef<HTMLDivElement>(null)
      const [reported, setReported] = useState<Readonly<Record<string, ContextValue>>>({})
      return (
        <CommandFocusScope rootRef={rootRef} context={{ 'chat.active': active }}>
          <div ref={rootRef}>
            <ContextReporter onContext={setReported} />
            <output aria-label="Reported context">{String(reported['chat.active'])}</output>
          </div>
        </CommandFocusScope>
      )
    }
    const { rerender } = render(<ContextOwner active />)
    expect(screen.getByLabelText('Reported context')).toHaveTextContent('true')
    rerender(<ContextOwner active />)
    expect(screen.getByLabelText('Reported context')).toHaveTextContent('true')
    rerender(<ContextOwner active={false} />)
    expect(screen.getByLabelText('Reported context')).toHaveTextContent('false')
  })

  it.each([false, true])('routes sibling commands by keyboard target with reversed order %s', (reverse) => {
    const names = reverse ? ['B', 'A'] : ['A', 'B']
    render(
      <Providers>
        {names.map((name) => (
          <Surface key={name} name={name} />
        ))}
      </Providers>
    )

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus A' }))).toBe(true)
    expect(screen.getByLabelText('A actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('B actions')).toHaveTextContent('0')

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus B' }))).toBe(true)
    expect(screen.getByLabelText('A actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('B actions')).toHaveTextContent('1')
  })

  it('uses the focused nested context and handler in the same dispatch', () => {
    render(
      <Providers>
        <Surface name="parent" command="app.sidebar.open_1" context={{ 'webview.focused': true }}>
          <Surface name="child" command="app.sidebar.open_1" context={{ 'webview.focused': false }} />
        </Surface>
      </Providers>
    )

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus parent' }), '1', 'Digit1')).toBe(false)
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus child' }), '1', 'Digit1')).toBe(true)
    expect(screen.getByLabelText('parent actions')).toHaveTextContent('0')
    expect(screen.getByLabelText('child actions')).toHaveTextContent('1')
  })

  it('does not fall back to an ancestor or sibling when the focused command is disabled', () => {
    render(
      <Providers>
        <CommandCounter name="root" />
        <Surface name="parent">
          <Surface name="disabled" enabled={false} />
        </Surface>
        <Surface name="sibling" />
      </Providers>
    )

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus disabled' }))).toBe(false)
    for (const name of ['root', 'parent', 'disabled', 'sibling']) {
      expect(screen.getByLabelText(`${name} actions`)).toHaveTextContent('0')
    }
  })

  it('refuses an inactive retained scope and resumes only after reactivation', () => {
    const tree = (active: boolean) => (
      <Providers>
        <CommandCounter name="root" />
        <Surface name="retained" active={active} />
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus retained' }))).toBe(true)

    rerender(tree(false))
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus retained' }))).toBe(false)
    expect(screen.getByLabelText('retained actions')).toHaveTextContent('1')
    expect(screen.getByLabelText('root actions')).toHaveTextContent('0')

    rerender(tree(true))
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus retained' }))).toBe(true)
    expect(screen.getByLabelText('retained actions')).toHaveTextContent('2')
  })

  it('does not keep a removed focused scope as the owner of subsequent keyboard input', () => {
    const tree = (showFirst: boolean) => (
      <Providers>
        {showFirst && <Surface name="first" />}
        <Surface name="remaining" />
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(pressShortcut(screen.getByRole('button', { name: 'Focus first' }))).toBe(true)
    rerender(tree(false))

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus remaining' }))).toBe(true)
    expect(screen.queryByLabelText('first actions')).toBeNull()
    expect(screen.getByLabelText('remaining actions')).toHaveTextContent('1')
  })

  it('publishes local context changes to descendants and restores inherited values without leaking to siblings', () => {
    const tree = (registered: boolean) => (
      <Providers>
        <Surface name="parent" context={{ 'chat.active': false }}>
          {registered && <LocalContext />}
          <ContextIndicator name="parent" />
          <Surface name="child">
            <ContextIndicator name="child" />
          </Surface>
        </Surface>
        <Surface name="sibling" context={{ 'chat.active': false }}>
          <ContextIndicator name="sibling" />
        </Surface>
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(screen.getByLabelText('parent chat context')).toHaveTextContent('true')
    expect(screen.getByLabelText('child chat context')).toHaveTextContent('true')
    expect(screen.getByLabelText('sibling chat context')).toHaveTextContent('false')

    rerender(tree(false))
    expect(screen.getByLabelText('parent chat context')).toHaveTextContent('false')
    expect(screen.getByLabelText('child chat context')).toHaveTextContent('false')
    expect(screen.getByLabelText('sibling chat context')).toHaveTextContent('false')
  })

  it('removes the owning context registration when two registrations have the same value', () => {
    const tree = (firstRegistered: boolean) => (
      <Providers>
        <Surface name="list">
          {firstRegistered && <LocalContext key="first" />}
          <LocalContext key="middle" value={false} />
          <LocalContext key="last" />
          <ContextIndicator name="list" />
        </Surface>
      </Providers>
    )
    const { rerender } = render(tree(true))
    expect(screen.getByLabelText('list chat context')).toHaveTextContent('true')

    rerender(tree(false))
    expect(screen.getByLabelText('list chat context')).toHaveTextContent('true')
  })

  it('does not delete resources while editing even when the shortcut has modifiers', () => {
    render(
      <Providers>
        <Surface name="resources" command="resource.delete_permanently" context={{ 'resource.focused': true }}>
          <input aria-label="Rename input" />
          <textarea aria-label="Draft text" />
          <select aria-label="Resource category">
            <option>Default category</option>
          </select>
          <div contentEditable suppressContentEditableWarning>
            <button type="button">Editable resource descendant</button>
          </div>
        </Surface>
      </Providers>
    )

    for (const name of ['Rename input', 'Draft text', 'Resource category']) {
      expect(pressShortcut(screen.getByLabelText(name), 'Backspace', 'Backspace')).toBe(false)
    }
    expect(
      pressShortcut(screen.getByRole('button', { name: 'Editable resource descendant' }), 'Backspace', 'Backspace')
    ).toBe(false)
    expect(screen.getByLabelText('resources actions')).toHaveTextContent('0')

    expect(pressShortcut(screen.getByRole('button', { name: 'Focus resources' }), 'Backspace', 'Backspace')).toBe(true)
    expect(screen.getByLabelText('resources actions')).toHaveTextContent('1')
  })

  it('preserves unmodified editing keys in an inherited contenteditable surface', () => {
    render(
      <Providers>
        <Surface name="editor" command="app.fullscreen.exit">
          <div contentEditable suppressContentEditableWarning>
            <button type="button">Editable descendant</button>
            <div contentEditable={false}>
              <button type="button">Noneditable island</button>
            </div>
          </div>
        </Surface>
      </Providers>
    )
    const pressEscape = (name: string) => {
      const target = screen.getByRole('button', { name })
      const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        target.focus()
        target.dispatchEvent(event)
      })
      return event.defaultPrevented
    }

    expect(pressEscape('Editable descendant')).toBe(false)
    expect(screen.getByLabelText('editor actions')).toHaveTextContent('0')
    expect(pressEscape('Noneditable island')).toBe(true)
    expect(screen.getByLabelText('editor actions')).toHaveTextContent('1')
  })
})
