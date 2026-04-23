import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeBaseNameDialog from '../KnowledgeBaseNameDialog'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
    <button {...props}>{loading ? 'loading' : children}</button>
  ),
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <h1 {...props}>{children}</h1>
  ),
  FieldError: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div role="alert" {...props}>
      {children}
    </div>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Label: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <label {...props}>{children}</label>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.cancel': '取消',
          'common.name': '名称',
          'knowledge_v2.context.rename': '重命名',
          'knowledge_v2.error.failed_to_edit': '知识库编辑失败',
          'knowledge_v2.name_required': '知识库名称为必填项',
          'knowledge_v2.rename_title': '重命名知识库'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const renderDialog = ({
  initialName = 'Research',
  isSubmitting = false,
  onSubmit = vi.fn().mockResolvedValue(undefined),
  onOpenChange = vi.fn()
}: {
  initialName?: string
  isSubmitting?: boolean
  onSubmit?: (name: string) => Promise<void>
  onOpenChange?: (open: boolean) => void
} = {}) => {
  render(
    <KnowledgeBaseNameDialog
      open
      initialName={initialName}
      isSubmitting={isSubmitting}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )

  return {
    onSubmit,
    onOpenChange
  }
}

describe('KnowledgeBaseNameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the rename title and submit button', () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: '重命名知识库' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument()
  })

  it('submits the trimmed knowledge base name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderDialog({ onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  Archive  ' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
  })

  it('shows the knowledge base update failure message when submission fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))

    renderDialog({ onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
    expect(screen.getByText('知识库编辑失败')).toBeInTheDocument()
  })
})
