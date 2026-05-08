import type { Prompt } from '@shared/data/types/prompt'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, Ref } from 'react'
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
    className: _className,
    loading: _loading,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: ({ className: _className, ...props }: ComponentProps<'input'> & { className?: string }) => (
    <input {...props} />
  ),
  Textarea: {
    Input: ({
      className: _className,
      hasError: _hasError,
      onValueChange,
      ref,
      ...props
    }: Omit<ComponentProps<'textarea'>, 'onChange'> & {
      hasError?: boolean
      onValueChange?: (value: string) => void
      ref?: Ref<HTMLTextAreaElement>
    }) => <textarea {...props} ref={ref} onChange={(event) => onValueChange?.(event.currentTarget.value)} />
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

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span />,
  Braces: () => <span />,
  Save: () => <span />
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
