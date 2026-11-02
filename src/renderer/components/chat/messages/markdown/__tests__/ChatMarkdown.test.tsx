import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('opens file links through openPath without navigating when no preview is available', async () => {
    const openPath = vi.fn()
    const notifyError = vi.fn()
    mocks.actions = { openPath, isDirectory: async () => false, notifyError }
    render(<ChatMarkdown block={{ id: 'part', content: '[Notes](/home/user/notes.md)', status: 'success' }} />)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    fireEvent(screen.getByRole('link', { name: 'Notes' }), click)

    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(openPath).toHaveBeenCalledWith('/home/user/notes.md'))
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('encoded UNC link does not reach the file opener', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(false)
    mocks.actions = { openPath, isDirectory }
    render(
      <ChatMarkdown
        block={{ id: 'part', content: '[Notes](%5C%5Cattacker.example%5Cshare%5Cnotes.txt)', status: 'success' }}
      />
    )
    const link = screen.getByRole('link', { name: 'Notes' })
    expect(link).toHaveAttribute('href', '%5C%5Cattacker.example%5Cshare%5Cnotes.txt')

    await user.click(link)

    expect(openPath).not.toHaveBeenCalled()
    expect(isDirectory).not.toHaveBeenCalled()
  })

  it('whitespace-prefixed UNC link does not reach the file opener', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(false)
    mocks.actions = { openPath, isDirectory }
    render(
      <ChatMarkdown
        block={{ id: 'part', content: '[Notes](%20%5C%5Cattacker.example%5Cshare%5Cnotes.txt)', status: 'success' }}
      />
    )
    const link = screen.getByRole('link', { name: 'Notes' })
    expect(link).toHaveAttribute('href', '%20%5C%5Cattacker.example%5Cshare%5Cnotes.txt')

    await user.click(link)

    expect(openPath).not.toHaveBeenCalled()
    expect(isDirectory).not.toHaveBeenCalled()
  })

  it('punctuation-prefixed UNC link does not reach the file opener', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(false)
    mocks.actions = { openPath, isDirectory }
    render(
      <ChatMarkdown
        block={{ id: 'part', content: '[Notes](%28%5C%5Cattacker.example%5Cshare%5Cnotes.txt)', status: 'success' }}
      />
    )
    const link = screen.getByRole('link', { name: 'Notes' })
    expect(link).toHaveAttribute('href', '%28%5C%5Cattacker.example%5Cshare%5Cnotes.txt')

    await user.click(link)

    expect(openPath).not.toHaveBeenCalled()
    expect(isDirectory).not.toHaveBeenCalled()
  })

  it('prefers the artifact preview for file links when both openers are available', async () => {
    const user = userEvent.setup()
    const openArtifactFile = vi.fn()
    const openPath = vi.fn()
    mocks.actions = { openArtifactFile, openPath, isDirectory: async () => false }
    render(<ChatMarkdown block={{ id: 'part', content: '[Notes](/home/user/notes.md)', status: 'success' }} />)

    await user.click(screen.getByRole('link', { name: 'Notes' }))

    expect(openArtifactFile).toHaveBeenCalledWith('/home/user/notes.md')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports file opening failures without navigating when only openPath is available', async () => {
    const openPath = vi.fn().mockRejectedValue(new Error('boom'))
    const notifyError = vi.fn()
    mocks.actions = { openPath, isDirectory: async () => false, notifyError }
    render(<ChatMarkdown block={{ id: 'part', content: '[Notes](/home/user/notes.md)', status: 'success' }} />)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    fireEvent(screen.getByRole('link', { name: 'Notes' }), click)

    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(notifyError).toHaveBeenCalledExactlyOnceWith('chat.input.tools.open_file_error'))
  })
})
