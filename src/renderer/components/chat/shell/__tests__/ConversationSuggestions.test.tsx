import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationSuggestions } from '../ConversationSuggestions'

const mocks = vi.hoisted(() => ({ emit: vi.fn(), useConversationSuggestions: vi.fn() }))

vi.mock('@renderer/hooks/useConversationSuggestions', () => ({
  useConversationSuggestions: mocks.useConversationSuggestions
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => ['zh-CN'] }))
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
    mocks.useConversationSuggestions.mockReturnValue({
      suggestions: ['Clarify the problem', 'Learn a concept', 'Explore a topic'],
      isLoading: false
    })
  })

  it('fills the targeted composer without submitting a conversation', () => {
    render(
      <ConversationSuggestions
        mode="chat"
        conversationId="topic-1"
        topicId="topic-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clarify the problem' }))

    expect(mocks.emit).toHaveBeenCalledWith('FILL_CHAT_COMPOSER', {
      topicId: 'topic-1',
      text: 'Clarify the problem'
    })
    expect(screen.getByTestId('conversation-suggestions')).toHaveClass('flex', 'flex-col', 'items-start')
    expect(screen.getByRole('button', { name: 'Clarify the problem' })).toHaveClass(
      'min-h-7',
      'rounded-full',
      'bg-background-subtle',
      'border-transparent',
      'text-foreground-disabled!',
      'whitespace-normal!'
    )
    expect(screen.getByText('Clarify the problem')).not.toHaveClass('truncate')
    expect(mocks.useConversationSuggestions).toHaveBeenCalledWith(expect.objectContaining({ outputLanguage: 'zh-CN' }))
  })

  it('renders stable placeholders while the suggestions are loading', () => {
    mocks.useConversationSuggestions.mockReturnValue({ suggestions: undefined, isLoading: true })
    render(
      <ConversationSuggestions
        mode="agent"
        conversationId="session-1"
        topicId="agent-session:session-1"
        fallback={['Fallback one', 'Fallback two', 'Fallback three']}
      />
    )

    expect(screen.getByTestId('conversation-suggestions-loading').children).toHaveLength(3)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
