import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Components } from 'streamdown'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import { AppMarkdown } from '../AppMarkdown'
import { MarkdownHostProvider } from '../MarkdownHostProvider'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const components: Partial<Components> = {
  code: ({ children }) => <textarea aria-label="Code draft" defaultValue={String(children)} />
}

describe('AppMarkdown', () => {
  it('preserves a code draft when streaming finishes and resets it for another document', async () => {
    const user = userEvent.setup()
    const source = '```text\noriginal\n```'
    const view = render(
      <AppMarkdown id="first" isStreaming components={components}>
        {source}
      </AppMarkdown>
    )
    const draft = screen.getByRole('textbox', { name: 'Code draft' })
    await user.clear(draft)
    await user.type(draft, 'unsaved draft')

    view.rerender(
      <AppMarkdown id="first" components={components}>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('textbox', { name: 'Code draft' })).toHaveValue('unsaved draft')

    view.rerender(
      <AppMarkdown id="second" components={components}>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('textbox', { name: 'Code draft' })).toHaveValue('original\n')
  })

  it('repairs the same bold URL in static and streaming content', () => {
    const source = '**https://example.com/page**（说明）'
    const view = render(<AppMarkdown id="static">{source}</AppMarkdown>)
    expect(screen.getByRole('link', { name: 'https://example.com/page' })).toHaveAttribute(
      'href',
      'https://example.com/page'
    )
    view.rerender(
      <AppMarkdown id="stream" isStreaming>
        {source}
      </AppMarkdown>
    )
    expect(screen.getByRole('link', { name: 'https://example.com/page' })).toHaveAttribute(
      'href',
      'https://example.com/page'
    )
  })

  it('keeps a bracket formula with a blank line intact across streaming updates', () => {
    const view = render(
      <AppMarkdown id="math" isStreaming>{String.raw`Before

\[
a +

`}</AppMarkdown>
    )
    view.rerender(
      <AppMarkdown id="math" isStreaming>{String.raw`Before

\[
a +

b
\]

After`}</AppMarkdown>
    )
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('a+b')
    expect(screen.getByText('After')).toBeVisible()
  })

  it('renders code controls without granting execution or editing', async () => {
    render(<AppMarkdown>{'```python\nprint(1)\n```'}</AppMarkdown>, { wrapper: CodeStyleProvider })
    expect(await screen.findByRole('button', { name: 'code_block.copy.source' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'code_block.run' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.edit.label' })).not.toBeInTheDocument()
  })

  it('opens relative links only through an explicitly supplied host', async () => {
    const user = userEvent.setup()
    const openFilePath = vi.fn()
    render(
      <MarkdownHostProvider openFilePath={openFilePath}>
        <AppMarkdown>{'[Guide](./guide.md)'}</AppMarkdown>
      </MarkdownHostProvider>
    )
    await user.click(screen.getByRole('link', { name: 'Guide' }))
    expect(openFilePath).toHaveBeenCalledWith('./guide.md')
  })
})
