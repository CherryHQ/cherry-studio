import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import i18n from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCodeTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'
import type { RichEditorRef } from '../types'

beforeAll(async () => {
  await i18n.changeLanguage('en-us')
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 20))
})

async function mount(content = 'hello') {
  const ref: { current: RichEditorRef | null } = { current: null }
  const onMarkdownChange = vi.fn<(markdown: string) => void>()
  render(
    <RichEditor
      ref={ref}
      initialContent={content}
      autoFocus={false}
      ariaLabel="Content"
      enableImageInsertion={false}
      onMarkdownChange={onMarkdownChange}
    />
  )
  await waitFor(() => expect(ref.current?.getMarkdown().trimEnd()).toBe(content))
  const surface = screen.getByLabelText('Content')
  const editor = (surface as HTMLElement & { editor: Editor }).editor
  return { ref, surface, editor, onMarkdownChange }
}

describe('user command delivery', () => {
  it.each([1, 2, 3] as const)('delivers unfocused toolbar heading %s', async (level) => {
    const fixture = await mount()
    expect(fixture.editor.isFocused).toBe(false)
    await userEvent.setup().click(screen.getByRole('button', { name: new RegExp(`^Heading ${level}$`) }))
    expect(fixture.onMarkdownChange.mock.calls.at(-1)?.[0].trimEnd()).toBe(`${'#'.repeat(level)} hello`)
  })

  it('delivers removal of an unfocused heading', async () => {
    const fixture = await mount('# hello')
    expect(fixture.editor.isFocused).toBe(false)
    await userEvent.setup().click(screen.getByRole('button', { name: /^Paragraph$/ }))
    expect(fixture.onMarkdownChange.mock.calls.at(-1)?.[0].trimEnd()).toBe('hello')
  })

  it('delivers a focused toolbar heading', async () => {
    const fixture = await mount()
    act(() => fixture.surface.focus())
    expect(fixture.editor.isFocused).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: /^Heading 1$/ }))
    expect(fixture.onMarkdownChange.mock.calls.at(-1)?.[0].trimEnd()).toBe('# hello')
  })

  it('delivers an unfocused heading in the second block', async () => {
    const fixture = await mount('before\n\nhello')
    act(() => {
      fixture.editor.commands.setTextSelection(9)
    })
    expect(fixture.editor.isFocused).toBe(false)
    await userEvent.setup().click(screen.getByRole('button', { name: /^Heading 1$/ }))
    expect(fixture.onMarkdownChange.mock.calls.at(-1)?.[0].trimEnd()).toBe('before\n\n# hello')
  })

  it('does not deliver an unfocused programmatic heading', async () => {
    const fixture = await mount()
    expect(fixture.editor.isFocused).toBe(false)
    act(() => {
      fixture.editor.chain().focus().toggleHeading({ level: 1 }).run()
    })
    expect(fixture.ref.current?.getMarkdown().trimEnd()).toBe('# hello')
    expect(fixture.onMarkdownChange).not.toHaveBeenCalled()
  })

  it('loads a snapshot without reporting an edit', async () => {
    const fixture = await mount()
    act(() => fixture.ref.current?.setMarkdown('# A #'))
    expect(fixture.surface.querySelector('h1')?.textContent).toBe('A')
    expect(fixture.onMarkdownChange).not.toHaveBeenCalled()
  })
})
