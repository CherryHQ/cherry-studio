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
  const { ref, value, onChange, placeholder, actions } = props

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

vi.mock('lucide-react', () => ({
  Braces: () => <span />
}))

vi.mock('@renderer/components/PromptEditorField', () => ({
  default: MockPromptEditorField
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
    onPointerDownOutside
  }: {
    children: ReactNode
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
          if (!event.defaultPrevented) {
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

  it('inserts variables at the current prompt editor selection', async () => {
    const user = userEvent.setup()

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

  it('allows outside clicks to cancel the dialog', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

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
        onSave={vi.fn().mockResolvedValue(undefined)}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'dialog outside' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
