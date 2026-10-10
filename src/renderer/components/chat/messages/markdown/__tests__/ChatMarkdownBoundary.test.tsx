import { act, render, screen } from '@testing-library/react'
import { use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import ChatMarkdown from '../ChatMarkdown'

const previewLoad = vi.hoisted(() => Promise.withResolvers<void>())

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false, codeFancyBlock: true }),
  useOptionalMessageListActions: () => undefined
}))

vi.mock('@renderer/components/Preview/MermaidPreview', () => ({
  default: function MermaidPreview() {
    use(previewLoad.promise)
    return null
  }
}))

describe('ChatMarkdown loading boundary', () => {
  it('renders formatted text on the first commit', () => {
    render(<ChatMarkdown block={{ id: 'part', content: '# Ready\n\n**Formatted** text.', status: 'success' }} />)

    expect(screen.getByRole('heading', { name: 'Ready', level: 1 })).toBeVisible()
    expect(screen.getByText('Formatted')).toBeVisible()
  })

  it('preserves existing prose when a stream adds a diagram whose preview is still loading', async () => {
    const content = '# Reading position\n\nKeep this paragraph.'
    const { rerender } = render(<ChatMarkdown block={{ id: 'stream', content, status: 'streaming' }} />, {
      wrapper: CodeStyleProvider
    })
    const heading = await screen.findByRole('heading', { name: 'Reading position' }, { timeout: 10000 })

    try {
      rerender(
        <ChatMarkdown
          block={{
            id: 'stream',
            content: `${content}\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\``,
            status: 'streaming'
          }}
        />
      )

      expect(screen.getByRole('heading', { name: 'Reading position' })).toBe(heading)
      await act(async () => {
        await vi.dynamicImportSettled()
      })
      expect(heading).toBeVisible()
      expect(screen.getByRole('paragraph')).toHaveTextContent('Keep this paragraph.')
    } finally {
      await act(async () => {
        previewLoad.resolve()
        await vi.dynamicImportSettled()
      })
    }

    expect(screen.getByRole('heading', { name: 'Reading position' })).toBe(heading)
  })
})
