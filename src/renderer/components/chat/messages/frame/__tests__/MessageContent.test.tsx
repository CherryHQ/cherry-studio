import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageContent from '../MessageContent'

vi.mock('../../blocks/MessagePartsRenderer', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Output limit reached. This response may be incomplete.' })
}))

const message: MessageListItem = { id: 'm', topicId: 't', role: 'assistant', createdAt: '', status: 'pending' }
describe('MessageContent output limit', () => {
  it('shows an accessible notice even without message parts', () => {
    render(<MessageContent message={{ ...message, finishReason: 'length' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Output limit reached. This response may be incomplete.')
    expect(screen.getByRole('status')).toBeVisible()
  })
  it.each(['stop', undefined] as const)('does not show the notice for %s', (finishReason) => {
    render(<MessageContent message={{ ...message, finishReason }} />)
    expect(screen.queryByText('Output limit reached. This response may be incomplete.')).toBeNull()
  })
})
