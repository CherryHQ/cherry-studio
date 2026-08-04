// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})

describe('MessageListSearch', () => {
  it('labels icon controls and exposes filter pressed states', async () => {
    const user = userEvent.setup()
    render(
      <MessageListSearch messages={[]} locateMessage={vi.fn()} scrollToRange={vi.fn()} scopeRef={{ current: null }} />
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
})
