import type { Prompt } from '@shared/data/types/prompt'
import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptSettings from '../PromptSettings'

const applyReorderedListMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: () => ({
    applyReorderedList: applyReorderedListMock,
    isPending: false
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/Icons', () => ({
  DeleteIcon: () => <span>Delete</span>,
  EditIcon: () => <span>Edit</span>
}))

vi.mock('@renderer/pages/files/FileItem', () => ({
  default: ({ fileInfo }: { fileInfo: { name: string; extra?: React.ReactNode; actions: React.ReactNode } }) => (
    <div data-testid={`prompt-row-${fileInfo.name}`}>
      <div>{fileInfo.name}</div>
      <div>{fileInfo.extra}</div>
      <div>{fileInfo.actions}</div>
    </div>
  )
}))

vi.mock('@renderer/components/DraggableList', () => ({
  DraggableList: ({
    list,
    onUpdate,
    children
  }: {
    list: Prompt[]
    onUpdate: (items: Prompt[]) => void
    children: (item: Prompt) => React.ReactNode
  }) => (
    <div>
      {list.map((item) => (
        <div key={item.id}>{children(item)}</div>
      ))}
      <button type="button" onClick={() => onUpdate([...list].reverse())}>
        mock-reorder
      </button>
    </div>
  )
}))

vi.mock('@cherrystudio/ui', () => {
  const Textarea = {
    Input: ({
      onValueChange,
      ...props
    }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { onValueChange?: (value: string) => void }) => (
      <textarea {...props} onChange={(event) => onValueChange?.(event.target.value)} />
    )
  }

  return {
    Button: ({
      children,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
      <button type="button" {...props} disabled={props.disabled || loading}>
        {children}
      </button>
    ),
    ConfirmDialog: ({
      open,
      title,
      description,
      confirmText,
      cancelText,
      onConfirm,
      onOpenChange
    }: {
      open: boolean
      title: string
      description: string
      confirmText: string
      cancelText: string
      onConfirm: () => void
      onOpenChange: (open: boolean) => void
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <div>{description}</div>
          <button type="button" onClick={onConfirm}>
            {confirmText}
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            {cancelText}
          </button>
        </div>
      ) : null,
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <>{children}</> : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
    DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Divider: () => <hr />,
    ColFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Flex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Spinner: ({ text }: { text: string }) => <div>{text}</div>,
    Textarea
  }
})

const prompts: Prompt[] = [
  {
    id: 'old',
    title: 'Old prompt',
    content: 'old content',
    orderKey: 'a0',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'new',
    title: 'New prompt',
    content: 'new content',
    orderKey: 'a1',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z'
  }
]

const mutationTriggers = new Map<string, ReturnType<typeof vi.fn>>()

describe('PromptSettings', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    mutationTriggers.clear()
    applyReorderedListMock.mockReset()
    applyReorderedListMock.mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryData('/prompts', prompts)
    MockUseDataApiUtils.seedCache('/prompts', prompts)
    mockUseMutation.mockImplementation((method: string, path: string) => {
      const trigger = vi.fn().mockResolvedValue(undefined)
      mutationTriggers.set(`${method} ${path}`, trigger)
      return {
        trigger,
        isLoading: false,
        error: undefined
      }
    })
    window.toast = {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn()
    } as unknown as typeof window.toast
  })

  it('updates an existing prompt through the edit modal', async () => {
    render(<PromptSettings />)

    const row = screen.getByTestId('prompt-row-New prompt')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    fireEvent.change(screen.getByPlaceholderText('settings.prompts.titlePlaceholder'), {
      target: { value: 'Updated prompt' }
    })
    fireEvent.change(screen.getByPlaceholderText('settings.prompts.contentPlaceholder'), {
      target: { value: 'updated content' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(mutationTriggers.get('PATCH /prompts/:id')).toHaveBeenCalledWith({
        params: { id: 'new' },
        body: { title: 'Updated prompt', content: 'updated content' }
      })
    })
  })

  it('deletes a prompt after confirmation', async () => {
    render(<PromptSettings />)

    const row = screen.getByTestId('prompt-row-Old prompt')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => {
      expect(mutationTriggers.get('DELETE /prompts/:id')).toHaveBeenCalledWith({ params: { id: 'old' } })
    })
  })

  it('reorders display order back to canonical API order before patching', async () => {
    render(<PromptSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'mock-reorder' }))

    await waitFor(() => {
      expect(applyReorderedListMock).toHaveBeenCalledWith([prompts[1], prompts[0]])
    })
  })
})
