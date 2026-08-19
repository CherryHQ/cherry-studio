import type { McpPrompt } from '@shared/types/mcp'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { McpPromptArgumentDialog } from '../mcpPromptArgumentDialog'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading,
    type = 'button',
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    type?: 'button' | 'submit'
    [key: string]: unknown
  }) => (
    <button type={type} {...props}>
      {loading ? 'loading' : children}
    </button>
  ),
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => {
    void props
    return <div role="dialog">{children}</div>
  },
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldError: ({ children, errors }: { children?: ReactNode; errors?: Array<{ message?: string }> }) => (
    <div role="alert">{errors?.map((error) => error.message).join('') || children}</div>
  ),
  FieldLabel: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  RequiredMark: () => <span>*</span>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'chat.input.mcp_prompts.fill_arguments': 'Fill prompt arguments',
          'chat.input.mcp_prompts.fill_arguments_description': 'Provide values before inserting',
          'chat.input.mcp_prompts.insert': 'Insert',
          'common.cancel': 'Cancel',
          'common.required_field': 'Required field'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const prompt: McpPrompt = {
  id: 'review',
  name: 'review',
  description: 'Review a patch',
  serverId: 'server-1',
  serverName: 'demo',
  arguments: [
    { name: 'language', required: true, description: 'Target language' },
    { name: 'style', description: 'Optional voice' }
  ]
}

describe('McpPromptArgumentDialog', () => {
  it('refuses to submit until required arguments are filled', () => {
    const onSubmit = vi.fn()
    const onValuesChange = vi.fn()

    render(
      <McpPromptArgumentDialog
        open
        prompt={prompt}
        values={{ language: '', style: '' }}
        submitting={false}
        onValuesChange={onValuesChange}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Required field')
  })

  it('submits after required arguments are filled, including empty optionals', () => {
    const onSubmit = vi.fn()

    render(
      <McpPromptArgumentDialog
        open
        prompt={prompt}
        values={{ language: 'Go', style: '' }}
        submitting={false}
        onValuesChange={vi.fn()}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
