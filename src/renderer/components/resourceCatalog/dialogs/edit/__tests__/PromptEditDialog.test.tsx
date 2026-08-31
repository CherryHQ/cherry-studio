import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import PromptEditDialog from '../PromptEditDialog'

const dialogHarness = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

let promptEditorElement: HTMLTextAreaElement | null = null

function MockPromptEditorField(props: any) {
  const { ref, value, onChange, placeholder, actions, resetPreviewKey } = props

  if (ref) {
    ref.current = {
      insertText: (text: string) => {
        if (!promptEditorElement) return false

        const start = promptEditorElement.selectionStart ?? value.length
        const end = promptEditorElement.selectionEnd ?? start
        onChange(`${value.slice(0, start)}${text}${value.slice(end)}`)
        return true
      }
    }
  }

  return (
    <div>
      {actions}
      <textarea
        ref={(node) => {
          promptEditorElement = node
        }}
        aria-label="prompt-editor"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button type="button">common.preview</button>
      <span>library.config.prompt.tokens_label</span>
      <output data-testid="prompt-preview-reset-key">{resetPreviewKey}</output>
    </div>
  )
}

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

vi.mock('@renderer/components/PromptEditorField', () => ({
  default: MockPromptEditorField
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions', () => ({
  PromptPolishActions: ({
    fallbackSource,
    emptyValueSystemPrompt,
    existingValueSystemPrompt,
    onChange,
    disabled
  }: {
    fallbackSource?: string
    emptyValueSystemPrompt: string
    existingValueSystemPrompt: string
    onChange: (value: string) => void
    disabled?: boolean
  }) => (
    <>
      <button
        type="button"
        data-fallback-source={fallbackSource}
        data-empty-value-system-prompt={emptyValueSystemPrompt}
        data-existing-value-system-prompt={existingValueSystemPrompt}
        disabled={disabled}
        onClick={() => onChange('Polished library prompt')}>
        library.config.prompt.polish
      </button>
    </>
  )
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
  Dialog: ({
    open,
    onOpenChange,
    children
  }: {
    open: boolean
    onOpenChange?: (open: boolean) => void
    children: ReactNode
  }) => {
    dialogHarness.onOpenChange = onOpenChange
    return open ? <div>{children}</div> : null
  },
  DialogContent: ({
    children,
    closeOnOverlayClick = true,
    onPointerDownOutside
  }: {
    children: ReactNode
    closeOnOverlayClick?: boolean
    onPointerDownOutside?: (event: { defaultPrevented: boolean; preventDefault: () => void }) => void
  }) => (
    <div role="dialog">
      {children}
      <button
        type="button"
        aria-label="dialog outside"
        onClick={() => {
          const event = {
            defaultPrevented: false,
            preventDefault: () => {
              event.defaultPrevented = true
            }
          }
          onPointerDownOutside?.(event)
          if (closeOnOverlayClick) {
            dialogHarness.onOpenChange?.(false)
          }
        }}
      />
    </div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Switch: ({
    checked,
    onCheckedChange,
    size: _size,
    ...props
  }: ComponentProps<'button'> & {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    size?: string
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-size={_size}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
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
          visibility: 'global',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'library.config.prompt.generate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toBeInTheDocument()
    expect(screen.getByText((content) => content.startsWith('library.config.prompt.tokens_label'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.preview' })).toBeInTheDocument()

    const editor = screen.getByLabelText('prompt-editor')
    await user.clear(editor)
    await user.type(editor, 'Updated content')
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        title: 'Old title',
        content: 'Updated content',
        visibility: 'global'
      })
    })
  })

  it('writes the polished prompt into the saved library prompt', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Old title',
          content: 'Old content',
          visibility: 'global',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('0')
    await user.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    expect(screen.getByLabelText('prompt-editor')).toHaveValue('Polished library prompt')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        title: 'Old title',
        content: 'Polished library prompt',
        visibility: 'global'
      })
    })
  })

  it('uses the prompt title as the blank-content generation fallback', () => {
    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Old title',
          content: '',
          visibility: 'global',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toHaveAttribute(
      'data-fallback-source',
      'Old title'
    )
    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toHaveAttribute(
      'data-empty-value-system-prompt',
      expect.stringContaining('reusable user message or instruction')
    )
    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toHaveAttribute(
      'data-existing-value-system-prompt',
      expect.stringContaining('Do not convert it into a system prompt or introduce an assistant persona.')
    )
  })

  it('disables prompt polishing while saving', () => {
    render(
      <PromptEditDialog open saving prompt={null} onSave={vi.fn().mockResolvedValue(undefined)} onCancel={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toBeDisabled()
  })

  it('inserts variables at the current prompt editor selection', async () => {
    const user = userEvent.setup()

    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Old title',
          content: 'Old content',
          visibility: 'global',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    )

    const editor = screen.getByLabelText('prompt-editor') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(4, 11)

    await user.click(screen.getByRole('button', { name: 'library.config.prompt.insert_variable' }))

    await waitFor(() => expect(editor).toHaveValue('Old ${variable}'))
  })

  it('keeps prompt edits open when clicking the overlay', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Old title',
          content: 'Old content',
          visibility: 'global',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'dialog outside' }))

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('saves when making a restricted prompt global', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <PromptEditDialog
        open
        prompt={{
          id: '018f8f16-3540-7cc2-b3cc-11ef1e3f35ac',
          title: 'Shared prompt',
          content: 'Shared content',
          visibility: 'restricted',
          orderKey: 'a0',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z'
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('switch', { name: 'settings.prompts.visibility.global.label' }))
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        title: 'Shared prompt',
        content: 'Shared content',
        visibility: 'global'
      })
    )
  })
})
