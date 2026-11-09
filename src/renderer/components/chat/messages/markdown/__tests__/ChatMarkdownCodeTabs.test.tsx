import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { AppMarkdown } from '@renderer/components/markdown'

import ChatMarkdown from '../ChatMarkdownRuntime'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => undefined
}))

function EditableCode({ children }: { children?: unknown; node?: unknown }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <textarea aria-label="Code" value={draft ?? String(children)} onChange={(event) => setDraft(event.target.value)} />
  )
}
const components = { code: EditableCode }
const source = '```ts\nconst one = 1\n```\n\n```py\nprint(2)\n```'

describe('chat code tabs integration', () => {
  it.each(['success', 'streaming'] as const)(
    'groups %s messages and retains source when switching panels',
    async (status) => {
      const user = userEvent.setup()
      render(<ChatMarkdown block={{ id: 'part', content: source, status }} components={components} />)
      expect(screen.getAllByRole('tab')).toHaveLength(2)
      expect(screen.getByRole('textbox')).toHaveValue('const one = 1\n')
      await user.click(screen.getByRole('tab', { name: 'py' }))
      expect(screen.getByRole('textbox')).toHaveValue('print(2)\n')
    }
  )

  it('preserves selection and draft through streaming append and completion, and resets on a new message identity', async () => {
    const user = userEvent.setup()
    const view = (content: string, status: 'streaming' | 'success', id = 'part') => (
      <ChatMarkdown block={{ id, content, status }} components={components} />
    )
    const { rerender } = render(view(source, 'streaming'))
    await user.click(screen.getByRole('tab', { name: 'py' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'print("draft")')
    const growing = `${source}\n\n~~~css\nbody {`
    rerender(view(growing, 'streaming'))
    expect(screen.getByRole('tab', { name: 'py' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox')).toHaveValue('print("draft")')
    await user.click(screen.getByRole('tab', { name: 'css' }))
    expect(screen.getByRole('textbox')).toHaveValue('body {\n')
    rerender(view(`${growing}}\n~~~`, 'success'))
    expect(screen.getByRole('tab', { name: 'css' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox')).toHaveValue('body {}\n')
    await user.click(screen.getByRole('tab', { name: 'py' }))
    expect(screen.getByRole('textbox')).toHaveValue('print("draft")')
    rerender(view(source, 'success', 'other'))
    expect(screen.getByRole('tab', { name: 'ts' })).toHaveAttribute('aria-selected', 'true')
  })

  it('groups within quote containers, numbers duplicate and missing languages, and preserves boundaries', () => {
    const fences = '```ts\none\n```\n\n```ts\ntwo\n```\n\n```\nthree\n```'
    const quote = fences
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const content = quote + '\n\nText\n\n`inline`\n\n' + source
    render(<ChatMarkdown block={{ id: 'part', content, status: 'success' }} components={components} />)
    const lists = screen.getAllByRole('tablist')
    expect(lists).toHaveLength(2)
    expect(
      within(lists[0])
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['ts 1', 'ts 2', '代码块 1'])
    expect(within(lists[1]).getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByText('Text')).toBeVisible()
  })

  it('does not group single blocks, file paths, raw HTML, or non-chat Markdown', () => {
    const content =
      '```ts\none\n```\n\n```\n/tmp/test.ts\n```\n\n```py\ntwo\n```\n\n<div>boundary</div>\n\n```css\nbody {}\n```'
    const { rerender } = render(
      <ChatMarkdown block={{ id: 'part', content, status: 'success' }} components={components} />
    )
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    rerender(<AppMarkdown components={components}>{source}</AppMarkdown>)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })
})
