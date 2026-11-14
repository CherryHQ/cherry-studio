import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { MarkdownLivePreview } from '../MarkdownLivePreview'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

// JSDOM has no layout; ProseMirror still measures the caret during paste and pointer events.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
document.elementFromPoint = () => null

// The real pipeline must render document-wide references, rather than independently parsed fragments.
describe('Markdown document live preview', () => {
  it('renders tables, formulas and reference links without changing the source', async () => {
    const onChange = vi.fn()
    render(
      <MarkdownLivePreview
        label="Document"
        value={
          '# Heading\n\n| Key | Value |\n| --- | --- |\n| One | Two |\n\n$x^2$\n\n[Documentation][docs]\n\n[docs]: https://example.com/docs\n'
        }
        onChange={onChange}
      />
    )
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeVisible()
    expect(screen.getByRole('table')).toHaveTextContent('KeyValueOneTwo')
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('x2')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('retains image definitions and footnotes from the complete document', async () => {
    render(
      <MarkdownLivePreview
        label="Document"
        value={
          '![Diagram][image]\n\nText[^note].\n\n[image]: https://example.com/diagram.png\n\n[^note]: Footnote explanation.\n'
        }
        onChange={() => undefined}
      />
    )
    expect(await screen.findByRole('img', { name: 'Diagram' })).toHaveAttribute(
      'src',
      'https://example.com/diagram.png'
    )
    expect(await screen.findByText('Footnote explanation.')).toBeVisible()
    const reference = screen.getByRole('link', { name: '1' })
    const target = reference.getAttribute('href')!.slice(1)
    expect(document.getElementById(target)).toHaveTextContent('Footnote explanation.')
  })

  it('reveals source on click and restores rich rendering on blur without saving', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <MarkdownLivePreview label="Document" value={'# Heading\n\nBody'} onChange={onChange} />
        <button type="button">Outside</button>
      </>
    )
    await user.click(await screen.findByRole('heading', { name: 'Heading' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Heading' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Document' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeVisible()
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['first', 'First explanation.'],
    ['second', 'Second explanation.']
  ])('edits the %s footnote definition when its rendered text is clicked', async (id, explanation) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const source =
      'Text[^second] and [^first].\n\n[^first]: First explanation.\n\n[^second]: Second explanation.\n\n# End'
    render(<MarkdownLivePreview label="Document" value={source} onChange={onChange} />)

    await user.click(await screen.findByText(explanation))
    await user.paste('EDIT ')

    expect(onChange).toHaveBeenLastCalledWith(source.replace(`[^${id}]:`, `EDIT [^${id}]:`))
  })

  it('keeps read-only documents rendered when clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MarkdownLivePreview label="Document" value="# Heading" onChange={onChange} readOnly />)
    await user.click(await screen.findByRole('heading', { name: 'Heading' }))
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Document' })).toHaveAttribute('contenteditable', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })
})
