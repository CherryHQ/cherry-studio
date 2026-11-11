import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessagePreviewContent } from '../MessagePreviewContent'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

describe('MessagePreviewContent', () => {
  it('keeps markdown and tool requests readable without links, approval controls, or playable media', async () => {
    const { container } = render(
      <MessagePreviewContent
        message={{
          id: 'request',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: '**Decision** [Open](https://example.com)\n\n```sh\necho hello\n```\n\n<video autoplay src="test.mp4"></video>'
            },
            {
              type: 'tool-AskUserQuestion',
              toolCallId: 'ask',
              state: 'approval-requested',
              approval: { id: 'approval' },
              input: {
                questions: [
                  {
                    header: 'Theme',
                    question: 'Which theme?',
                    multiSelect: false,
                    options: [
                      { label: 'Light', description: 'Light theme' },
                      { label: 'Dark', description: 'Dark theme' }
                    ]
                  }
                ]
              }
            }
          ]
        }}
      />
    )
    expect(screen.getByText('Which theme?')).toBeInTheDocument()
    expect(screen.getByText('· Light')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-streamdown=strong]')).toHaveTextContent('Decision'))
    expect(container.querySelectorAll('a,button,input,video,audio,iframe')).toHaveLength(0)
  })

  it('bounds long text while preserving its latest tail and signaling omitted content', () => {
    render(
      <MessagePreviewContent
        message={{
          id: 'long',
          role: 'assistant',
          parts: [{ type: 'text', text: `OLD_PREFIX${'x'.repeat(5000)}LATEST_TAIL` }]
        }}
      />
    )
    expect(screen.queryByText(/OLD_PREFIX/)).not.toBeInTheDocument()
    expect(screen.getByText(/LATEST_TAIL/)).toBeInTheDocument()
    expect(screen.getByText('…')).toBeInTheDocument()
  })
})
