import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandId } from '@shared/utils/command'

const { loggerMock, preferenceValues } = vi.hoisted(() => ({
  loggerMock: {
    warn: vi.fn(),
    error: vi.fn()
  },
  preferenceValues: {} as Record<string, unknown>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [preferenceValues[key] ?? false, vi.fn()],
  useMultiplePreferences: () => [preferenceValues, vi.fn()]
}))

import { type CommandHandler, useCommandHandler, useCommandRuntime } from '@renderer/hooks/command'

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandProvider } from '../CommandProvider'

function RegisteredCommand({
  command,
  enabled = true,
  onExecute
}: {
  command: CommandId
  enabled?: boolean
  onExecute: () => void
}) {
  useCommandHandler(command, onExecute, { enabled })
  return null
}

function renderProvider(children: ReactNode) {
  return render(
    <CommandContextKeyProvider>
      <CommandProvider>{children}</CommandProvider>
    </CommandContextKeyProvider>
  )
}

function dispatchShortcut(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    ctrlKey: true,
    cancelable: true,
    ...init
  })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  window.dispatchEvent(event)
  return preventDefault
}

describe('CommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(preferenceValues)) {
      delete preferenceValues[key]
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('executes the matching command from keyboard input', () => {
    const onExecute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" onExecute={onExecute} />)

    const preventDefault = dispatchShortcut({})

    expect(onExecute).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('does not intercept command shortcuts without an active handler', () => {
    renderProvider(null)

    const preventDefault = dispatchShortcut({})

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('uses the most recently registered handler and falls back after unregister', () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <RegisteredCommand command="topic.create" onExecute={first} />
          <RegisteredCommand command="topic.create" onExecute={second} />
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    dispatchShortcut({})
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()

    rerender(
      <CommandContextKeyProvider>
        <CommandProvider>
          <RegisteredCommand command="topic.create" onExecute={first} />
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    dispatchShortcut({})
    expect(first).toHaveBeenCalledOnce()
  })

  it('does not intercept disabled handlers', () => {
    const onExecute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" enabled={false} onExecute={onExecute} />)

    const preventDefault = dispatchShortcut({})

    expect(onExecute).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('reads handler availability at the key event', () => {
    const onExecute = vi.fn()
    let available = false

    function LiveAvailability() {
      useCommandHandler('topic.create', onExecute, { enabled: () => available })
      return null
    }

    renderProvider(<LiveAvailability />)

    const blocked = dispatchShortcut({})
    expect(onExecute).not.toHaveBeenCalled()
    expect(blocked).not.toHaveBeenCalled()

    available = true
    const allowed = dispatchShortcut({})
    expect(onExecute).toHaveBeenCalledOnce()
    expect(allowed).toHaveBeenCalledOnce()

    available = false
    const blockedAgain = dispatchShortcut({})
    expect(onExecute).toHaveBeenCalledOnce()
    expect(blockedAgain).not.toHaveBeenCalled()
  })

  it('skips composing events', () => {
    const onExecute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" onExecute={onExecute} />)

    dispatchShortcut({ isComposing: true })

    expect(onExecute).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'a contenteditable element', target: 'contenteditable' },
    { name: 'an input', target: 'input' }
  ])('skips no-modifier shortcuts when $name is focused', ({ target }) => {
    const onExecute = vi.fn()
    const testId = `editable-${target}`
    renderProvider(
      <>
        <RegisteredCommand command="app.fullscreen.exit" onExecute={onExecute} />
        {target === 'input' ? <input data-testid={testId} /> : <div contentEditable="true" data-testid={testId} />}
      </>
    )

    fireEvent.keyDown(screen.getByTestId(testId), {
      key: 'Escape',
      code: 'Escape',
      cancelable: true
    })

    expect(onExecute).not.toHaveBeenCalled()
  })

  it('still dispatches modifier shortcuts when an editable target is focused', () => {
    const onExecute = vi.fn()
    renderProvider(
      <>
        <RegisteredCommand command="topic.create" onExecute={onExecute} />
        <div contentEditable="true" data-testid="editable" />
      </>
    )

    fireEvent.keyDown(screen.getByTestId('editable'), {
      key: 'n',
      code: 'KeyN',
      ctrlKey: true,
      cancelable: true
    })

    expect(onExecute).toHaveBeenCalledOnce()
  })
})

describe('keyboard routing predicates', () => {
  function PredicateCommand({ accept, onExecute }: { accept: boolean; onExecute: () => void }) {
    useCommandHandler('topic.create', onExecute, { shouldHandleKeyEvent: () => accept })
    return null
  }

  it('ignores the legacy IME composition key code', () => {
    const execute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" onExecute={execute} />)
    const prevented = dispatchShortcut({ keyCode: 229 })
    expect(execute).not.toHaveBeenCalled()
    expect(prevented).not.toHaveBeenCalled()
  })

  it('uses the latest predicate and active registration without falling back', () => {
    const first = vi.fn()
    const second = vi.fn()
    const tree = (accept: boolean, showSecond: boolean) => (
      <CommandContextKeyProvider>
        <CommandProvider>
          <PredicateCommand accept onExecute={first} />
          {showSecond && <PredicateCommand accept={accept} onExecute={second} />}
        </CommandProvider>
      </CommandContextKeyProvider>
    )
    const { rerender } = render(tree(false, true))
    expect(dispatchShortcut({})).not.toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    rerender(tree(true, true))
    expect(dispatchShortcut({})).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    rerender(tree(false, false))
    expect(dispatchShortcut({})).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledOnce()
  })

  it('dispatches a pre-cancelled event when no predicate is provided', () => {
    const execute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" onExecute={execute} />)
    const event = new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('executes the matched callback even when a predicate updates its live source', () => {
    const first = vi.fn()
    const replacement = vi.fn()
    function ChangingSource() {
      const runtime = useCommandRuntime()
      useLayoutEffect(() => {
        const source: { current: CommandHandler } = { current: first }
        return runtime.registerHandler('topic.create', source, {
          shouldHandleKeyEvent: () => {
            source.current = replacement
            return true
          }
        })
      }, [runtime])
      return null
    }
    renderProvider(<ChangingSource />)
    dispatchShortcut({})
    expect(first).toHaveBeenCalledOnce()
    expect(replacement).not.toHaveBeenCalled()
    dispatchShortcut({})
    expect(first).toHaveBeenCalledOnce()
    expect(replacement).toHaveBeenCalledOnce()
  })
})
