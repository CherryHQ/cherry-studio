import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationSuggestions } from '../ConversationSuggestions'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  suggestionsEnabled: true,
  useConversationSuggestions: vi.fn()
}))

vi.mock('@renderer/hooks/chat/useConversationSuggestions', () => ({
  useConversationSuggestions: mocks.useConversationSuggestions
}))
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.suggestionsEnabled]
}))
vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { FILL_CHAT_COMPOSER: 'FILL_CHAT_COMPOSER' },
  EventEmitter: { emit: mocks.emit }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-us', resolvedLanguage: 'en-us' } })
}))

describe('ConversationSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.suggestionsEnabled = true
    mocks.useConversationSuggestions.mockReturnValue({
      suggestions: ['Clarify the problem', 'Learn a concept', 'Explore a topic'],
      isLoading: false
    })
  })

  it('fills the targeted composer without submitting a conversation', async () => {
    const user = userEvent.setup()
    render(
      <ConversationSuggestions
        mode="chat"
        conversationId="topic-1"
        topicId="topic-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clarify the problem' }))

    expect(mocks.emit).toHaveBeenCalledWith('FILL_CHAT_COMPOSER', {
      topicId: 'topic-1',
      text: 'Clarify the problem'
    })
  })

  it('does not expose selectable prompts while suggestions are loading', () => {
    mocks.useConversationSuggestions.mockReturnValue({ suggestions: undefined, isLoading: true })
    render(
      <ConversationSuggestions
        mode="agent"
        conversationId="session-1"
        topicId="agent-session:session-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('hides suggestions when the user disables the feature', () => {
    mocks.suggestionsEnabled = false

    render(
      <ConversationSuggestions
        mode="chat"
        conversationId="topic-1"
        topicId="topic-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    expect(mocks.useConversationSuggestions).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-suggestions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-suggestions-loading')).not.toBeInTheDocument()
  })
})
