import type { CommandId } from '@shared/utils/command'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { useCommandHandler, useCommandRuntime } from '@renderer/hooks/command'

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

function RuntimeButton({ command }: { command: CommandId }) {
  const runtime = useCommandRuntime()
  return (
    <button type="button" onClick={() => runtime.execute(command)}>
      execute
    </button>
  )
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

  it('registers one global keydown listener', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderProvider(null)

    expect(addEventListener.mock.calls.filter(([type]) => String(type) === 'keydown')).toHaveLength(1)
    unmount()
    expect(removeEventListener.mock.calls.filter(([type]) => String(type) === 'keydown')).toHaveLength(1)
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

  it('skips composing events', () => {
    const onExecute = vi.fn()
    renderProvider(<RegisteredCommand command="topic.create" onExecute={onExecute} />)

    dispatchShortcut({ isComposing: true } as KeyboardEventInit)

    expect(onExecute).not.toHaveBeenCalled()
  })

  it('skips no-modifier shortcuts when an editable target is focused', () => {
    const onExecute = vi.fn()
    renderProvider(
      <>
        <RegisteredCommand command="app.fullscreen.exit" onExecute={onExecute} />
        <div contentEditable="true" data-testid="editable" />
      </>
    )

    fireEvent.keyDown(screen.getByTestId('editable'), {
      key: 'Escape',
      code: 'Escape',
      cancelable: true
    })

    expect(onExecute).not.toHaveBeenCalled()
  })

  it('skips no-modifier shortcuts when an input is focused', () => {
    const onExecute = vi.fn()
    renderProvider(
      <>
        <RegisteredCommand command="app.fullscreen.exit" onExecute={onExecute} />
        <input data-testid="text-input" />
      </>
    )

    fireEvent.keyDown(screen.getByTestId('text-input'), {
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

  it('warns when executing a command without an active handler', () => {
    renderProvider(<RuntimeButton command="topic.create" />)

    fireEvent.click(screen.getByRole('button', { name: 'execute' }))

    expect(loggerMock.warn).toHaveBeenCalledWith('No renderer command handler registered: topic.create')
  })
})
