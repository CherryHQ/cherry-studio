import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import PromptEditorField from '../PromptEditorField'

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

vi.mock('@renderer/context/CodeStyleProvider', () => ({
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
    CodeEditor: ({
      value,
      onChange,
      placeholder
    }: ComponentProps<'textarea'> & {
      value: string
      onChange?: (value: string) => void
    }) => (
      <textarea
        aria-label="Prompt editor"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
    )
  }
})

describe('PromptEditorField', () => {
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
})
