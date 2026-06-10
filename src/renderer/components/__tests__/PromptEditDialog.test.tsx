import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import PromptEditDialog from '../PromptEditDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.prompts.variablePlaceholder': '${variable}'
      })[key] ?? key
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

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('lucide-react', () => ({
  Braces: () => <span />,
  Edit: () => <span />,
  Eye: () => <span />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: (props: ComponentProps<'button'> & { loading?: boolean; variant?: string; size?: string }) => {
    const { children, type = 'button', ...buttonProps } = props
    delete buttonProps.loading
    delete buttonProps.variant
    delete buttonProps.size
    return (
      <button type={type} {...buttonProps}>
        {children}
      </button>
    )
  },
  CodeEditor: ({
    value,
    onChange,
    placeholder
  }: {
    value: string
    onChange?: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="prompt-editor"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Field: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  FieldContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldError: ({ errors }: { errors?: { message: string }[] }) => <div>{errors?.[0]?.message}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

describe('PromptEditDialog', () => {
  it('uses the shared prompt editor without prompt generation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Old title',
          content: 'Old content',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'library.config.prompt.generate' })).not.toBeInTheDocument()
    expect(screen.getByText((content) => content.startsWith('library.config.prompt.tokens_label'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.preview' })).toBeInTheDocument()

    const editor = screen.getByLabelText('prompt-editor')
    await user.click(screen.getByRole('button', { name: 'library.config.prompt.insert_variable' }))
    await waitFor(() => expect(editor).toHaveValue('Old content ${variable}'))

    await user.clear(editor)
    await user.type(editor, 'Updated content')
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        title: 'Old title',
        content: 'Updated content'
      })
    })
  })
})
