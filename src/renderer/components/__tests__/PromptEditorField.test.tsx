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

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    activeCmTheme: 'light'
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
    expect(editorContainer).not.toHaveClass('bg-accent/15', 'focus-within:bg-accent/20')
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

    const tokenColor = (text: string, occurrence = 0) => {
      const allTokens = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-content span'))
      const tokens = allTokens.filter((token) => token.textContent === text)
      if (!tokens[occurrence]) {
        throw new Error(
          `Missing token ${text}; rendered tokens: ${allTokens.map((token) => token.textContent).join('|')}`
        )
      }
      return getComputedStyle(tokens[occurrence]).color
    }

    expect(tokenColor('#')).toBe('var(--color-foreground-secondary)')
    expect(tokenColor(' Heading')).toBe('var(--color-foreground)')
    expect(tokenColor('**')).toBe('var(--color-foreground-secondary)')
    expect(tokenColor('link')).toBe('var(--color-primary)')
    expect(tokenColor('[')).toBe('var(--color-foreground-secondary)')

    view.destroy()
    parent.remove()
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
