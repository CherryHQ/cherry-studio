import type * as CherryStudioUi from '@cherrystudio/ui'
import { StreamingMarkdown } from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatMarkdownRenderProvider } from '../ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from '../ChatMarkdownRenderers'

const mocks = vi.hoisted(() => ({
  CodeBlock: vi.fn(({ children, isStreaming }: { children: string; isStreaming: boolean }) => (
    <code data-streaming={String(isStreaming)}>{children}</code>
  ))
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('../CodeBlock', () => ({ default: mocks.CodeBlock }))

const EMPTY_CITATIONS = new Map()

function renderCode(isStreaming: boolean) {
  return (
    <ChatMarkdownRenderProvider blockId="message-part" citationRegistry={EMPTY_CITATIONS} isStreaming={isStreaming}>
      <StreamingMarkdown
        id="message-part"
        components={CHAT_MARKDOWN_COMPONENTS}
        animated={false}
        parseIncompleteMarkdown={isStreaming}>
        {'```typescript\nconst first = 1\n```\n\n```typescript\nconst second = 2\n```'}
      </StreamingMarkdown>
    </ChatMarkdownRenderProvider>
  )
}

describe('ChatMarkdown renderers', () => {
  it('shares renderer types between the base and style-enabled registries', () => {
    for (const tag of Object.keys(CHAT_MARKDOWN_COMPONENTS)) {
      expect(CHAT_MARKDOWN_COMPONENTS_WITH_STYLE[tag]).toBe(CHAT_MARKDOWN_COMPONENTS[tag])
    }
  })

  it('keeps code renderer nodes mounted when streaming settles', () => {
    const { rerender } = render(renderCode(true))
    const firstCode = screen.getByText('const first = 1')
    const secondCode = screen.getByText('const second = 2')

    expect(firstCode).toHaveAttribute('data-streaming', 'true')
    expect(secondCode).toHaveAttribute('data-streaming', 'true')

    rerender(renderCode(false))

    expect(screen.getByText('const first = 1')).toBe(firstCode)
    expect(screen.getByText('const second = 2')).toBe(secondCode)
    expect(firstCode).toHaveAttribute('data-streaming', 'false')
    expect(secondCode).toHaveAttribute('data-streaming', 'false')
  })
})
