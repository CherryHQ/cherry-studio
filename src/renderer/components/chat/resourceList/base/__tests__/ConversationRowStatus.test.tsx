import { render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { ConversationRowStatus } from '../ConversationRowStatus'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('ConversationRowStatus', () => {
  it('steps the stream overlay aside when the action rail is pinned', () => {
    render(<ConversationRowStatus status="pending" testId="row-status" />)

    // A pinned rail stays expanded at rest; without this offset the overlay
    // would sit underneath the pin button.
    expect(screen.getByTestId('row-status')).toHaveClass(
      'group-has-[[data-resource-list-item-actions][data-pinned=true]]:right-7'
    )
  })
})
