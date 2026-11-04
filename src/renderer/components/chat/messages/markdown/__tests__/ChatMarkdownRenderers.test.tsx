import { render, screen } from '@testing-library/react'
import type { ImgHTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { StreamingMarkdown } from '@cherrystudio/ui'

import { ChatMarkdownRenderProvider } from '../ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS } from '../ChatMarkdownRenderers'

const mocks = vi.hoisted(() => ({
  CodeBlock: vi.fn(({ children, isStreaming }: { children: string; isStreaming: boolean }) => (
    <code data-streaming={String(isStreaming)}>{children}</code>
  ))
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('../CodeBlock', () => ({ default: mocks.CodeBlock }))
vi.mock('@renderer/components/ImageViewer', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />
}))

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
