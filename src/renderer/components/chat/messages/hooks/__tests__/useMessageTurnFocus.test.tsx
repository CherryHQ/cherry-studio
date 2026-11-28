import { act, fireEvent, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import { useMessageTurnFocus } from '../useMessageTurnFocus'

const commandHandlers = vi.hoisted(() => new Map<string, () => void>())
const writeText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/command', async () => {
  const { createContext } = await import('react')
  return {
    ContextKeyRegisterContext: createContext(undefined),
    useCommandHandler: (id: string, handler: () => void) => {
      commandHandlers.set(id, handler)
    }
  }
})
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/utils/message/composerTokens', () => ({
  getComposerTextFromParts: (parts: Array<{ text: string }>) => parts.map((part) => part.text).join('')
}))

const turns = [['turn-1', [{ id: 'm1' } as MessageListItem]]] as const

function Harness() {
  const { surfaceProps } = useMessageTurnFocus({
    turns,
    getMessageParts: () => [{ type: 'text', text: 'selected turn' }] as never,
    scrollToTurn: vi.fn(),
    resetKey: 'topic'
  })
  return (
    <div data-testid="surface" {...surfaceProps}>
      <span data-testid="inside" tabIndex={0}>
        inside
      </span>
      {createPortal(
        <div data-testid="portaled" tabIndex={0}>
          portaled
        </div>,
        document.body
      )}
    </div>
  )
}

describe('useMessageTurnFocus', () => {
  beforeEach(() => {
    commandHandlers.clear()
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  const selectTurn = () => {
    fireEvent.focus(screen.getByTestId('inside'))
    act(() => commandHandlers.get('chat.message.focus_next')?.())
  }

  it('copies the selected turn on Enter from inside the list', () => {
    render(<Harness />)
    selectTurn()

    fireEvent.keyDown(screen.getByTestId('inside'), { key: 'Enter' })

    expect(writeText).toHaveBeenCalledWith('selected turn')
  })

  it('ignores Enter from a portaled element whose React event bubbles through the list', () => {
    render(<Harness />)
    selectTurn()

    fireEvent.keyDown(screen.getByTestId('portaled'), { key: 'Enter' })

    expect(writeText).not.toHaveBeenCalled()
  })
})
