import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultMessageRenderConfig } from '../../types'
import { MessagePreview } from '../MessagePreview'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
afterEach(cleanup)

describe('MessagePreview presentation boundary', () => {
  it('renders a question without a conversation provider or executable list actions', () => {
    render(
      <MessagePreview
        config={{ ...defaultMessageRenderConfig, messageStyle: 'bubble' }}
        author={{ name: 'You' }}
        message={{
          id: 'question',
          role: 'user',
          parts: [{ type: 'text', text: '**Keep this literal**' }]
        }}
      />
    )
    expect(screen.getByText('**Keep this literal**')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
