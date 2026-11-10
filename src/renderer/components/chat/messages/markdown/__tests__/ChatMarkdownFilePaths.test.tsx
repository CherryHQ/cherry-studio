import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import ChatMarkdownRuntime from '../ChatMarkdownRuntime'

const mocks = vi.hoisted(() => ({ isWin: false, navigateToRoute: vi.fn() }))

vi.mock('@renderer/utils/platform', () => ({
  platform: 'darwin',
  get isWin() {
    return mocks.isWin
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => ({ navigateToRoute: mocks.navigateToRoute })
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

beforeEach(() => {
  mocks.isWin = false
  mocks.navigateToRoute.mockClear()
})

describe('ChatMarkdown file paths', () => {
  it('links prose and code paths without changing URLs or trusting spoofed markers', async () => {
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
      '/Users/lee/inline.txt',
      '/Users/lee/fenced.txt',
      '/app/config.json'
    ])
    expect(screen.getByRole('link', { name: 'https://example.com/plain' })).toHaveAttribute(
      'href',
      'https://example.com/plain'
    )
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/docs')
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

describe('ChatMarkdown code entries', () => {
  const path = 'modules/file-hash/android/src/main/java/expo/modules/filehash/FileHashModule.kt'

  it.each([
    ['name    value\nalpha   10\nbeta    20', 'name    value\nalpha   10\nbeta    20'],
    ['name    value\n<code>alpha</code>   10\nbeta    20', 'name    value\nalpha   10\nbeta    20']
  ])('preserves raw preformatted rows and spacing: %s', async (html, text) => {
    render(<ChatMarkdownRuntime block={{ id: 'raw-pre', content: `<pre>${html}</pre>`, status: 'success' }} />)

    // Native preformatted whitespace is required even when the content also includes inline code.
    const pre = (await screen.findByText(/name\s+value/)).closest('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toBe(text)
  })

  it.each([
    ['inline', '`' + path + '`'],
    ['plain fence', '```\n' + path + '\n```'],
    ['text fence', '```text\n' + path + '\n```']
  ])('renders a %s path without code styling', async (_kind, content) => {
    render(<ChatMarkdownRuntime block={{ id: 'code-path', content, status: 'success' }} />)

    const link = await screen.findByRole('link', { name: path })
    // Neither code nor pre may impose code backgrounds or preformatted wrapping on file entries.
    expect(link.closest('code, pre')).toBeNull()
  })

  it.each([
    ['/Users/foo/bar.tsx', '/Users/foo/bar.tsx'],
    ['src/index.ts:42:5', 'src/index.ts'],
    ['./src/index.ts', './src/index.ts'],
    ['../packages/ui/src/', '../packages/ui/src/'],
    ['/Users/lee/My Project/notes.txt', '/Users/lee/My Project/notes.txt'],
    ['/app/not-a-route', '/app/not-a-route']
  ])('preserves path recognition for %s', async (input, expected) => {
    render(<ChatMarkdownRuntime block={{ id: 'path-format', content: '`' + input + '`', status: 'success' }} />)
    expect(await screen.findByRole('link', { name: expected })).toHaveAttribute('data-file-path', expected)
  })

  it.each(['/app/chat', '/settings/skills', '/settings/channels', '/app/mini-app/example'])(
    'routes %s through the navigation entry',
    async (path) => {
      const user = userEvent.setup()
      render(<ChatMarkdownRuntime block={{ id: 'route', content: '`' + path + '`', status: 'success' }} />)

      await user.click(await screen.findByRole('button'))
      expect(mocks.navigateToRoute).toHaveBeenCalledWith({ path, query: undefined })
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    }
  )

  it.each(['`const count = 1`', '```javascript\n' + path + '\n```', '```text\n/tmp/first.ts\n/tmp/second.ts\n```'])(
    'keeps ordinary or multiline code as code: %s',
    async (content) => {
      render(<ChatMarkdownRuntime block={{ id: 'ordinary-code', content, status: 'success' }} />)

      expect(await screen.findByRole('code')).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    }
  )

  it('does not promote POSIX code paths on Windows', async () => {
    mocks.isWin = true
    render(<ChatMarkdownRuntime block={{ id: 'windows-code', content: '`/home/user/file.ts`', status: 'success' }} />)
    expect(await screen.findByRole('code')).toHaveTextContent('/home/user/file.ts')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    ['text', 'WWWW  x\niiii  x\n\tindented'],
    ['python', 'if ready:\n    run()'],
    ['javascript', path]
  ])(
    'preserves the preformatted surface for %s fences while streaming and after completion',
    async (language, text) => {
      const content = '```' + language + '\n' + text
      const { rerender } = render(
        <ChatMarkdownRuntime block={{ id: 'ordinary-fence', content, status: 'streaming' }} />
      )

      // The pre surface owns the configured code font, tab stops, whitespace and block spacing.
      expect((await screen.findByRole('code')).closest('pre')).not.toBeNull()

      rerender(<ChatMarkdownRuntime block={{ id: 'ordinary-fence', content: content + '\n```', status: 'success' }} />)
      expect((await screen.findByRole('code')).closest('pre')).not.toBeNull()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    }
  )

  it('preserves the preformatted surface for file fences on Windows', async () => {
    mocks.isWin = true
    render(
      <ChatMarkdownRuntime block={{ id: 'windows-fence', content: '```text\n' + path + '\n```', status: 'success' }} />
    )
    expect((await screen.findByRole('code')).closest('pre')).not.toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('promotes a path only when its fence closes, even while the message is streaming', async () => {
    const content = '```text\n' + path
    const { rerender } = render(
      <ChatMarkdownRuntime block={{ id: 'streaming-code-path', content, status: 'streaming' }} />
    )
    const code = await screen.findByRole('code')
    expect(code).toHaveTextContent(path)
    expect(code.closest('pre')).not.toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    rerender(
      <ChatMarkdownRuntime
        block={{ id: 'streaming-code-path', content: content + '\n```\n\nContinuing', status: 'streaming' }}
      />
    )
    const link = await screen.findByRole('link', { name: path })
    expect(link.closest('code, pre')).toBeNull()
  })
})
