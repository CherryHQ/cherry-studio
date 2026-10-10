import { render, screen } from '@testing-library/react'
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

  it.each(['success', 'streaming'] as const)('keeps Markdown inside a native disclosure (%s)', async (status) => {
    const user = userEvent.setup()
    render(
      <ChatMarkdown
        block={{
          id: 'disclosure',
          status,
          content: String.raw`Before

<details>
<summary>Answer (click to expand)</summary>

$$
y = \frac{1}{2x} - \frac{1}{2x^3}
$$

**Quick check:** This content should be hidden while the disclosure is closed.
</details>

After`
        }}
        inlineHtmlPreviewMode="ready"
      />,
      { wrapper: CodeStyleProvider }
    )

    const summary = screen.getByText(
      (_, element) => element?.tagName === 'SUMMARY' && element.textContent === 'Answer (click to expand)'
    )
    const body = screen.getByText(
      (_, element) =>
        element?.textContent === 'Quick check:' &&
        !Array.from(element.children).some((child) => child.textContent === 'Quick check:')
    )
    expect(body).not.toBeVisible()
    await user.click(summary)
    expect(body).toBeVisible()
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('y')
    await user.click(summary)
    expect(body).not.toBeVisible()
    expect(screen.getByText('Before')).toBeVisible()
    expect(screen.getByText('After')).toBeVisible()
  })
})
