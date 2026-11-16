import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConversationCenterState from '../ConversationCenterState'

vi.unmock('@cherrystudio/ui')

describe('ConversationCenterState', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('offers a new conversation from the empty chat center', async () => {
    await getI18n().changeLanguage('en-us')
    const onNewConversation = vi.fn()
    render(<ConversationCenterState state="empty" onNewConversation={onNewConversation} />)

    expect(screen.getByRole('heading', { name: 'No conversation selected' })).toBeInTheDocument()
    expect(screen.getByText('Pick one from the list, or start a new conversation.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'New Conversation' }))
    expect(onNewConversation).toHaveBeenCalledTimes(1)
  })

  it('shows the agent copy without an action when the host cannot start a session', async () => {
    await getI18n().changeLanguage('en-us')
    render(<ConversationCenterState state="empty" variant="agent" />)

    expect(screen.getByRole('heading', { name: 'No task selected' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each(['chat', 'agent'] as const)('draws only translated words in the Chinese %s scene', async (variant) => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<ConversationCenterState state="empty" variant={variant} />)
    const scene = container.querySelector('[data-slot="empty-state-scene"]')

    expect(scene).not.toBeNull()
    expect(scene?.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
