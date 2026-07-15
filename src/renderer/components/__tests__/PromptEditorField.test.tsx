import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { EditorView } from '@codemirror/view'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadLanguage } from '@uiw/codemirror-extensions-langs'
import { type ComponentProps, type ReactNode, type Ref, useImperativeHandle, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptEditorField from '../PromptEditorField'

type MockCodeEditorProps = ComponentProps<'textarea'> & {
  ref?: Ref<{ focus: () => void }>
  value: string
  onChange?: (value: string) => void
  options?: { foldGutter?: boolean; lineNumbers?: boolean }
  theme?: unknown
}

const mocks = vi.hoisted(() => ({
  theme: 'light' as 'light' | 'dark',
  codeEditorProps: undefined as
    | {
        options?: { foldGutter?: boolean; lineNumbers?: boolean }
        theme?: unknown
      }
    | undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.edit': 'Edit',
          'common.preview': 'Preview',
          'library.config.prompt.dblclick_hint': 'Double click to edit',
          'library.config.prompt.tokens_label': 'Tokens: '
        }) as Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [14]
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: mocks.theme
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    Markdown: ({ id, children }: { id: string; children: ReactNode }) => (
      <div data-testid="markdown" data-md-id={id}>
        {children}
      </div>
    ),
    CodeEditor: ({ ref, value, onChange, placeholder, autoFocus, options, theme }: MockCodeEditorProps) => {
      const textareaRef = useRef<HTMLTextAreaElement>(null)
      mocks.codeEditorProps = { options, theme }
      useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus()
      }))
      return (
        <div className="cm-editor" data-testid="editor-empty-area">
          {options?.lineNumbers !== false || options?.foldGutter !== false ? (
            <div className="cm-gutters" data-testid="gutter" />
          ) : null}
          <div className="cm-content">
            <textarea
              ref={textareaRef}
              autoFocus={autoFocus}
              aria-label="Prompt editor"
              placeholder={placeholder}
              value={value}
              onChange={(event) => onChange?.(event.currentTarget.value)}
            />
          </div>
        </div>
      )
    }
  }
})

describe('PromptEditorField', () => {
  beforeEach(() => {
    mocks.theme = 'light'
    mocks.codeEditorProps = undefined
  })

  it('uses the prompt writing theme without a gutter', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)

    expect(mocks.codeEditorProps?.theme).not.toBe('light')
    expect(mocks.codeEditorProps?.options).toMatchObject({
      foldGutter: false,
      lineNumbers: false
    })
    expect(screen.queryByTestId('gutter')).not.toBeInTheDocument()

    const editorContainer = screen.getByTestId('editor-empty-area').parentElement
    expect(editorContainer).toHaveClass('bg-background')
    expect(editorContainer).toHaveClass('border-border', 'focus-within:border-border-hover')
    expect(editorContainer).toHaveClass('focus-within:ring-2', 'focus-within:ring-ring/50')
    expect(editorContainer).not.toHaveClass('bg-accent/15', 'focus-within:bg-accent/20')
    expect(editorContainer).not.toHaveClass('border-border/20', 'focus-within:border-border/40')
  })

  it('marks the prompt theme as dark in dark mode', () => {
    mocks.theme = 'dark'

    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)

    const theme = mocks.codeEditorProps?.theme
    if (!Array.isArray(theme)) throw new Error('Expected the prompt editor to provide a CodeMirror extension theme')

    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ extensions: theme, parent })

    expect(view.state.facet(EditorView.darkTheme)).toBe(true)

    view.destroy()
    parent.remove()
  })

  it('keeps Markdown markers visually secondary', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)

    const theme = mocks.codeEditorProps?.theme
    if (!Array.isArray(theme)) throw new Error('Expected the prompt editor to provide a CodeMirror extension theme')

    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      doc: '# Heading\n**strong** [link](https://example.com)',
      extensions: [loadLanguage('markdown')!, theme],
      parent
    })

    const tokenStyle = (text: string, occurrence = 0) => {
      const allTokens = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-content span'))
      const tokens = allTokens.filter((token) => token.textContent === text)
      if (!tokens[occurrence]) {
        throw new Error(
          `Missing token ${text}; rendered tokens: ${allTokens.map((token) => token.textContent).join('|')}`
        )
      }
      return getComputedStyle(tokens[occurrence])
    }

    expect(tokenStyle('#').color).toBe('var(--color-foreground-secondary)')
    expect(tokenStyle(' Heading').color).toBe('var(--color-foreground)')
    expect(tokenStyle(' Heading').fontWeight).toBe('var(--font-weight-medium)')
    expect(tokenStyle('**').color).toBe('var(--color-foreground-secondary)')
    expect(tokenStyle('strong').fontWeight).toBe('var(--font-weight-bold)')
    expect(tokenStyle('link').color).toBe('var(--color-primary)')
    expect(tokenStyle('[').color).toBe('var(--color-foreground-secondary)')
    expect(getComputedStyle(view.contentDOM).padding).toBe('var(--cs-size-3xs)')

    view.destroy()
    parent.remove()
  })

  it('composes fill layout classes without merging adjacent class names', () => {
    render(<PromptEditorField fill label={<span>Prompt</span>} value="Original prompt" onChange={vi.fn()} />)

    const preview = screen.getByTestId('markdown').parentElement
    const editorFrame = preview?.parentElement

    expect(preview).toHaveClass('text-xs', 'min-h-0', 'flex-1')
    expect(editorFrame).toHaveClass('flex-col', 'border-border')
  })

  it('does not submit a parent form when toggling preview', () => {
    const onSubmit = vi.fn()

    function Harness() {
      const [value, setValue] = useState('Original prompt')

      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}>
          <PromptEditorField label={<span>Prompt</span>} value={value} onChange={setValue} />
        </form>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Prompt editor'), { target: { value: 'Updated prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Updated prompt')).toBeInTheDocument()
  })

  it('focuses the editor when clicking the empty area around the content', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)

    const editor = screen.getByLabelText('Prompt editor')
    expect(editor).not.toHaveFocus()

    fireEvent.mouseDown(screen.getByTestId('editor-empty-area'))

    expect(editor).toHaveFocus()
  })

  it('focuses the editor when autoFocus is enabled', async () => {
    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField autoFocus label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByLabelText('Prompt editor')).toHaveFocus()
    })
  })
})
