import type { HandoffPartData } from '@shared/data/types/uiParts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({ openConversation: vi.fn() })
}))
vi.mock('react-i18next', async () => {
  const { createInstance } = await import('i18next')
  const { default: en } = await import('@renderer/i18n/locales/en-us.json')
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
  return { useTranslation: () => ({ t: i18n.t }) }
})

import HandoffBlock from '../HandoffBlock'

it('keeps the task visible while hiding the full Agent context until requested', async () => {
  const user = userEvent.setup()
  const data: HandoffPartData = {
    handoffId: 'handoff-1',
    payloadHash: 'hash',
    source: { kind: 'topic', id: 'topic-1' },
    targetAgentId: 'agent-1',
    targetAgentName: 'Reviewer',
    targetSessionId: 'session-1',
    goal: 'Review the change',
    initialAssistantMessageId: 'assistant-1',
    state: 'started'
  }
  const context = 'Task: Review the change\nBackground summary: Verify exact source first.\nOriginal session: topic-1'
  const view = render(<HandoffBlock data={data} context={context} conversationId="session-1" />)
  expect(screen.queryByRole('button', { name: 'Open Agent' })).not.toBeInTheDocument()
  expect(screen.getByText('Review the change')).toBeVisible()
  expect(screen.queryByText(/Original session/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Handoff context' }))
  expect(screen.getByText(/Original session/)).toHaveTextContent('Verify exact source first.')
  expect(screen.getByText(/Original session/)).toHaveTextContent('topic-1')
  await user.click(screen.getByRole('button', { name: 'Handoff context' }))
  expect(screen.queryByText(/Original session/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open source' })).toBeVisible()
  view.rerender(<HandoffBlock data={data} conversationId="topic-1" />)
  expect(screen.getByRole('button', { name: 'Open Agent' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument()
})
