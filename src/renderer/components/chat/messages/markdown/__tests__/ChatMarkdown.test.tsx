import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import ChatMarkdown from '../ChatMarkdownRuntime'

const mocks = vi.hoisted(() => ({
  actions: undefined as
    | undefined
    | {
        openArtifactFile?: (path: string) => void | Promise<void>
        openPath?: (path: string) => void | Promise<void>
        isDirectory?: (path: string) => Promise<boolean>
        notifyError?: (message: string) => void
        openExternalUrl?: (url: string) => void | Promise<void>
      }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => mocks.actions
}))
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

describe('ChatMarkdown adapter', () => {
  beforeEach(() => {
    mocks.actions = undefined
  })

  it('keeps the paused message placeholder in the chat adapter', () => {
    render(<ChatMarkdown block={{ id: 'part', content: '', status: 'paused' }} />)
    expect(screen.getByText('message.chat.completion.paused')).toBeVisible()
  })

  it('preserves code source while processing prose around HTML artifacts', () => {
    const source = 'Outside\n\n```html\n<script>const text = "Outside"</script>\n```'
    render(
      <ChatMarkdown
        block={{ id: 'part', content: source, status: 'success' }}
        inlineHtmlPreviewMode="ready"
        postProcess={(content) => content.replaceAll('Outside', 'Processed')}
        components={{ code: ({ children }) => <code>{children}</code> }}
      />,
      { wrapper: CodeStyleProvider }
    )
    expect(screen.getByText('Processed')).toBeVisible()
    expect(screen.getByText('<script>const text = "Outside"</script>')).toBeVisible()
  })

  it('routes directory links through the workspace-aware opener', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const openArtifactFile = vi.fn()
    mocks.actions = { openPath, openArtifactFile, isDirectory: vi.fn().mockResolvedValue(true) }
    render(<ChatMarkdown block={{ id: 'part', content: '[Docs](./docs)', status: 'success' }} />)
    await user.click(screen.getByRole('link', { name: 'Docs' }))
    expect(openPath).toHaveBeenCalledWith('./docs')
    expect(openArtifactFile).not.toHaveBeenCalled()
  })

  it.each([
    ['success', '/home/user/notes.md', '/home/user/notes.md'],
    ['streaming', '/home/user/notes.md', '/home/user/notes.md'],
    ['success', 'C:/Users/Alice/notes.md', 'C:/Users/Alice/notes.md'],
    ['success', './Docs%20Notes.md#section', './Docs Notes.md']
  ] as const)('routes %s file link %s through openPath without a preview', async (status, href, path) => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    mocks.actions = { openPath }
    render(<ChatMarkdown block={{ id: 'part', content: `[Notes](${href})`, status }} />)
    await user.click(screen.getByRole('link', { name: 'Notes' }))
    expect(openPath).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('reports a rejected file open to the host instead of silently navigating', async () => {
    const user = userEvent.setup()
    function Host() {
      const [error, setError] = useState<string>()
      mocks.actions = {
        openPath: async () => {
          throw new Error('Refusing to open an unusable path')
        },
        notifyError: setError
      }
      return (
        <>
          <ChatMarkdown block={{ id: 'part', content: '[Notes](./notes.md)', status: 'success' }} />
          {error && <div role="alert">{error}</div>}
        </>
      )
    }
    render(<Host />)
    await user.click(screen.getByRole('link', { name: 'Notes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('chat.input.tools.open_file_error')
  })

  it.each(['success', 'streaming'] as const)(
    'keeps unsafe schemes blocked with an openPath host (%s)',
    async (status) => {
      const user = userEvent.setup()
      const openPath = vi.fn()
      const openExternalUrl = vi.fn()
      mocks.actions = { openPath, openExternalUrl }
      const { container } = render(
        <ChatMarkdown
          block={{ id: 'part', content: '[Local](file:///tmp/notes.md)\n\n[Unsafe](javascript:alert)', status }}
        />
      )
      expect(container.querySelector('a[href^="file:"]')).toBeNull()
      expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
      await user.click(screen.getByText('Local'))
      await user.click(screen.getByText('Unsafe'))
      expect(openPath).not.toHaveBeenCalled()
      expect(openExternalUrl).not.toHaveBeenCalled()
    }
  )
})
