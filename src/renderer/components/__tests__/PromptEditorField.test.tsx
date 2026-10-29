import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, type ReactNode, type Ref, useImperativeHandle, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import PromptEditorField from '../PromptEditorField'

type MockCodeEditorProps = ComponentProps<'textarea'> & {
  ref?: Ref<{ focus: () => void }>
  value: string
  onChange?: (value: string) => void
  options?: { foldGutter?: boolean; lineNumbers?: boolean }
  editable?: boolean
}

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

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    Markdown: ({ id, children }: { id: string; children: ReactNode }) => (
      <div data-testid="markdown" data-md-id={id}>
        {children}
      </div>
    )
  }
})

vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: ({ ref, value, onChange, placeholder, autoFocus, options, editable }: MockCodeEditorProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
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
            readOnly={editable === false}
            onChange={(event) => onChange?.(event.currentTarget.value)}
          />
        </div>
      </div>
    )
  }
}))

describe('PromptEditorField', () => {
  // Regression guard for #18377: the prompt preview container must carry the
  // `prompt-preview` scope class so the scoped CSS rule can restore visible
  // line breaks (global `.markdown p { white-space: normal }` collapses soft
  // newlines; the scoped override re-enables pre-wrap here only).
  it('marks the preview container with the prompt-preview scope class (#18377)', () => {
    render(<PromptEditorField label={<span>Prompt</span>} value="Line one\nLine two" onChange={vi.fn()} />)

    const preview = screen.getByTestId('markdown').parentElement

    expect(preview).toHaveClass('prompt-preview')
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

  it('rejects typing while disabled', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [value, setValue] = useState('')
      return <PromptEditorField disabled label={<span>Prompt</span>} value={value} onChange={setValue} />
    }

    render(<Harness />)
    await user.type(screen.getByLabelText('Prompt editor'), 'Typed text')

    expect(screen.getByLabelText('Prompt editor')).toHaveValue('')
  })

  it('keeps the preview from switching to the editor while disabled', () => {
    render(<PromptEditorField disabled label={<span>Prompt</span>} value="Original prompt" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    fireEvent.doubleClick(screen.getByTestId('markdown'))

    expect(screen.queryByLabelText('Prompt editor')).not.toBeInTheDocument()
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
