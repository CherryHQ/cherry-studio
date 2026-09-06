import type * as CherryStudioUi from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ChatMarkdownRuntime from '../ChatMarkdownRuntime'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CodeBlock', () => ({
  default: ({ children }: { children?: ReactNode }) => <code>{children}</code>
}))

vi.mock('../Link', () => ({
  default: ({ children, href }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href}>{children}</a>
}))

vi.mock('@renderer/components/chat/messages/tools/shared/ClickableFilePath', () => ({
  ClickableFilePath: ({ path, displayName }: { path: string; displayName?: string }) => (
    <a href="#file" data-file-path={path}>
      {displayName ?? path}
    </a>
  )
}))

describe('ChatMarkdown bare file paths', () => {
  it('links only ordinary text paths in static assistant markdown', async () => {
    const content = `Open /Users/lee/report.pdf and “/Users/lee/My Project/notes.txt”.

Visit https://example.com/plain or [the docs](https://example.com/docs).

Inline: \`/Users/lee/inline.txt\`

\`\`\`text
/Users/lee/fenced.txt
\`\`\`

<span cherryBareFilePath="/Users/lee/spoof.txt">not a path</span>`

    const contentWithRoutes = `${content}\n\nOpen /app/chat or /app/config.json.`

    render(
      <ChatMarkdownRuntime
        block={{ id: 'static-file-paths', content: contentWithRoutes, status: 'success' }}
        linkifyFilePaths
      />
    )

    await screen.findByText('/Users/lee/report.pdf')
    const filePaths = Array.from(document.querySelectorAll<HTMLElement>('[data-file-path]'))
    expect(filePaths.map((node) => node.dataset.filePath)).toEqual([
      '/Users/lee/report.pdf',
      '/Users/lee/My Project/notes.txt',
      '/app/config.json'
    ])
    expect(screen.getByRole('link', { name: 'https://example.com/plain' })).toHaveAttribute(
      'href',
      'https://example.com/plain'
    )
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByText('/Users/lee/inline.txt').closest('[data-file-path]')).toBeNull()
    expect(screen.getByText('/Users/lee/fenced.txt').closest('[data-file-path]')).toBeNull()
    expect(screen.getByText('not a path').closest('[data-file-path]')).toBeNull()
  })

  it('installs the same path transform for streaming markdown', async () => {
    render(
      <ChatMarkdownRuntime
        block={{ id: 'streaming-file-path', content: 'Created ~/Downloads/report.pdf', status: 'streaming' }}
        linkifyFilePaths
      />
    )

    const path = await screen.findByText('~/Downloads/report.pdf')
    expect(path.closest('[data-file-path]')).toHaveAttribute('data-file-path', '~/Downloads/report.pdf')
  })
})
