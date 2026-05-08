import type { Prompt } from '@shared/data/types/prompt'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode, Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptConfigPage from '../PromptConfigPage'

const { createPromptMock, updatePromptMock } = vi.hoisted(() => ({
  createPromptMock: vi.fn(),
  updatePromptMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars?.max) return `${key}:${vars.max}`
      return key
    }
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
    const buttonProps = { ...props } as ComponentProps<'button'> & Record<string, unknown>
    delete buttonProps.loading
    delete buttonProps.size
    delete buttonProps.variant
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Textarea: {
    Input: ({
      onValueChange,
      ref,
      ...props
    }: Omit<ComponentProps<'textarea'>, 'onChange'> & {
      hasError?: boolean
      onValueChange?: (value: string) => void
      ref?: Ref<HTMLTextAreaElement>
    }) => {
      const textareaProps = { ...props } as Omit<ComponentProps<'textarea'>, 'onChange'> & Record<string, unknown>
      delete textareaProps.hasError
      return <textarea {...textareaProps} ref={ref} onChange={(event) => onValueChange?.(event.currentTarget.value)} />
    }
  }
}))

vi.mock('../../../adapters/promptAdapter', () => ({
  usePromptMutations: () => ({
    createPrompt: createPromptMock
  }),
  usePromptMutationsById: () => ({
    updatePrompt: updatePromptMock
  })
}))

vi.mock('../../ConfigEditorShell', () => ({
  ResourceEditorShell: ({
    children,
    onBack,
    saveButton,
    title
  }: {
    children: ReactNode
    onBack: () => void
    saveButton?: {
      canSave: boolean
      saving: boolean
      onSave: () => void
    }
    title: string
  }) => (
    <div>
      <button type="button" onClick={onBack}>
        common.back
      </button>
      <span>{title}</span>
      {saveButton && (
        <button type="button" disabled={saveButton.saving || !saveButton.canSave} onClick={() => saveButton.onSave()}>
          common.save
        </button>
      )}
      {children}
    </div>
  )
}))

vi.mock('lucide-react', () => ({
  Braces: () => <span />
}))

function createPrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'prompt-1',
    title: 'Daily Report',
    content: 'old content',
    orderKey: 'a0',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides
  }
}

describe('PromptConfigPage', () => {
  beforeEach(() => {
    createPromptMock.mockReset()
    updatePromptMock.mockReset()
    createPromptMock.mockImplementation(async (dto) => createPrompt({ id: 'created-prompt', ...dto }))
    updatePromptMock.mockImplementation(async (dto) => createPrompt({ ...dto }))
  })

  it('creates a prompt after title and content are filled', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()

    render(<PromptConfigPage onBack={vi.fn()} onCreated={onCreated} />)

    const saveButton = screen.getByRole('button', { name: /common.save/ })
    expect(saveButton).toBeDisabled()

    await user.type(screen.getByPlaceholderText('settings.prompts.titlePlaceholder'), '日报模板')
    await user.type(screen.getByPlaceholderText('settings.prompts.contentPlaceholder'), '今日完成 task')
    await user.click(saveButton)

    await waitFor(() => {
      expect(createPromptMock).toHaveBeenCalledWith({
        title: '日报模板',
        content: '今日完成 task'
      })
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'created-prompt' }))
  })

  it('updates only changed prompt fields in edit mode', async () => {
    const user = userEvent.setup()

    render(<PromptConfigPage prompt={createPrompt()} onBack={vi.fn()} />)

    const content = screen.getByDisplayValue('old content')
    await user.clear(content)
    await user.type(content, 'new content')
    await user.click(screen.getByRole('button', { name: /common.save/ }))

    await waitFor(() => {
      expect(updatePromptMock).toHaveBeenCalledWith({ content: 'new content' })
    })
  })

  it('inserts a prompt variable into the content field', async () => {
    const user = userEvent.setup()

    render(<PromptConfigPage onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /library.config.prompt.insert_variable/ }))

    expect(screen.getByDisplayValue('${variable}')).toBeInTheDocument()
  })
})
