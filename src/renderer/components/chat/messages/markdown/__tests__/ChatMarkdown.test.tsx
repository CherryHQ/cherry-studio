import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import ChatMarkdown from '../ChatMarkdown'

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

  it.each([false, true])('keeps disclosures interactive with complete content (streamed: %s)', async (streamed) => {
    const user = userEvent.setup()
    const getSummary = (text: string) =>
      screen.getByText((_, element) => element?.textContent === text, { selector: 'summary' })
    const getBody = () =>
      screen.getByText(
        (_, element) =>
          element?.textContent === 'Quick check: This content should be hidden while the disclosure is closed.',
        { selector: 'p' }
      )
    const source = String.raw`Before

<details>
<summary>Answer (click to expand)</summary>

$$
y = \frac{1}{2x} - \frac{1}{2x^3}
$$

**Quick check:** This content should be hidden while the disclosure is closed.

<details>
<summary>Nested answer</summary>

Nested content

</details>

</details>

After`
    const { container, rerender } = render(
      <ChatMarkdown
        block={{
          id: 'disclosure',
          content: streamed ? source.slice(0, source.indexOf('$$')) : source,
          status: streamed ? 'streaming' : 'success'
        }}
        inlineHtmlPreviewMode={streamed ? 'generating' : 'ready'}
      />,
      { wrapper: CodeStyleProvider }
    )
    if (streamed) {
      expect(getSummary('Answer (click to expand)')).toBeVisible()
      expect(container.querySelector('iframe')).toBeNull()
      rerender(
        <ChatMarkdown
          block={{ id: 'disclosure', content: source, status: 'streaming' }}
          inlineHtmlPreviewMode="generating"
        />
      )
      expect(getBody()).not.toBeVisible()
      await user.click(getSummary('Answer (click to expand)'))
      rerender(
        <ChatMarkdown block={{ id: 'disclosure', content: source, status: 'success' }} inlineHtmlPreviewMode="ready" />
      )
      expect(getBody()).toBeVisible()
      await user.click(getSummary('Answer (click to expand)'))
    }

    expect(screen.getByText('Before')).toBeVisible()
    expect(screen.getByText('After')).toBeVisible()
    const summary = getSummary('Answer (click to expand)')
    const body = getBody()
    expect(body).toHaveTextContent('Quick check: This content should be hidden while the disclosure is closed.')
    expect(body).not.toBeVisible()
    await user.click(summary)
    expect(body).toBeVisible()
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent(String.raw`y = \frac{1}{2x} - \frac{1}{2x^3}`)
    expect(screen.getByText('Nested content')).not.toBeVisible()
    await user.click(getSummary('Nested answer'))
    expect(screen.getByText('Nested content')).toBeVisible()
    await user.click(summary)
    expect(body).not.toBeVisible()
    expect(screen.getByText('Nested content')).not.toBeVisible()
    expect(container.querySelector('iframe')).toBeNull()
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
})
