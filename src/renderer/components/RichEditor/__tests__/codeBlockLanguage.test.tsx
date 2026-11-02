import { render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCodeTheme: 'one-light' })
}))

vi.mock('@renderer/components/Preview/MermaidPreview', () => ({ default: () => null }))

import RichEditor from '../RichEditor'
import type { RichEditorRef } from '../types'

beforeAll(async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  await i18n.changeLanguage('en-us')
})

describe('code block language search', () => {
  it('filters languages and preserves the selected language and code through a Markdown round trip', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useRef<RichEditorRef>(null))
    const ref = result.current
    const view = render(<RichEditor ref={ref} initialContent={'```text\nprint("hello")\n```'} autoFocus={false} />)

    await user.click(await screen.findByRole('button', { name: 'Language' }))
    const dialog = screen.getByRole('dialog')
    const search = within(dialog).getByRole('combobox')
    await user.type(search, 'PYTHON')
    expect(await within(dialog).findByRole('option', { name: 'python' })).toBeVisible()
    expect(within(dialog).queryByRole('option', { name: 'javascript' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('option', { name: 'python' }))

    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('```python'))
    const saved = ref.current!.getMarkdown()
    expect(saved).toContain('print("hello")')
    view.unmount()
    render(<RichEditor ref={ref} initialContent={saved} autoFocus={false} />)
    expect(await screen.findByRole('button', { name: 'Language' })).toHaveTextContent('python')
    expect(ref.current?.getMarkdown()).toContain('print("hello")')
  })

  it('supports searching from Mermaid source mode, empty results and reopening with a cleared search', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useRef<RichEditorRef>(null))
    const ref = result.current
    render(<RichEditor ref={ref} initialContent={'```mermaid\ngraph TD; A-->B\n```'} autoFocus={false} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Language' }))
    await user.type(within(screen.getByRole('dialog')).getByRole('combobox'), 'no-such-language')
    expect(await screen.findByText('No results')).toBeVisible()
    expect(within(screen.getByRole('dialog')).queryAllByRole('option')).toHaveLength(0)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Language' }))
    const search = within(screen.getByRole('dialog')).getByRole('combobox')
    expect(search).toHaveValue('')
    await user.type(search, 'javascript')
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('```javascript'))
    expect(ref.current?.getMarkdown()).toContain('graph TD; A-->B')
    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('javascript')
  })
})
