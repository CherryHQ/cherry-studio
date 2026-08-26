import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationSuggestions } from '../ConversationSuggestions'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  useConversationSuggestions: vi.fn()
}))

vi.mock('@renderer/hooks/chat/useConversationSuggestions', () => ({
  useConversationSuggestions: mocks.useConversationSuggestions
}))
vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { FILL_CHAT_COMPOSER: 'FILL_CHAT_COMPOSER' },
  EventEmitter: { emit: mocks.emit }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-us', resolvedLanguage: 'en-us' } })
}))

const chatFocus = 'conversation, learning, creativity, reflection, and planning'
const agentFocus = 'concrete tasks involving inspection, implementation, review, and verification'

describe('ConversationSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useConversationSuggestions.mockReturnValue({
      suggestions: ['Clarify the problem', 'Learn a concept', 'Explore a topic'],
      isLoading: false,
      suggestionsEnabled: true
    })
  })

  it('fills the targeted composer without submitting a conversation', async () => {
    const user = userEvent.setup()
    render(
      <ConversationSuggestions
        focus={chatFocus}
        conversationId="conversation-1"
        topicId="topic-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clarify the problem' }))

    expect(screen.getByRole('button', { name: 'Clarify the problem' })).toBeEnabled()
    expect(mocks.emit).toHaveBeenCalledWith('FILL_CHAT_COMPOSER', {
      topicId: 'topic-1',
      text: 'Clarify the problem'
    })
    expect(mocks.emit).not.toHaveBeenCalledWith(
      'FILL_CHAT_COMPOSER',
      expect.objectContaining({ topicId: 'conversation-1' })
    )
  })

  it('does not expose selectable prompts while suggestions are loading', () => {
    mocks.useConversationSuggestions.mockReturnValue({
      suggestions: undefined,
      isLoading: true,
      suggestionsEnabled: true
    })
    render(
      <ConversationSuggestions
        focus={agentFocus}
        conversationId="session-1"
        topicId="agent-session:session-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('hides suggestions when the user disables the feature', () => {
    mocks.useConversationSuggestions.mockReturnValue({
      suggestions: ['Clarify the problem', 'Learn a concept', 'Explore a topic'],
      isLoading: false,
      suggestionsEnabled: false
    })

    render(
      <ConversationSuggestions
        focus={chatFocus}
        conversationId="topic-1"
        topicId="topic-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-suggestions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-suggestions-loading')).not.toBeInTheDocument()
  })
})
