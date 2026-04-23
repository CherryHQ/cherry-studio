import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeEntityNameDialog from '../KnowledgeEntityNameDialog'

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
          'knowledge_v2.name_required': '知识库名称为必填项'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const renderDialog = ({
  initialName,
  isSubmitting = false,
  submitErrorMessage = '提交失败',
  onSubmit = vi.fn().mockResolvedValue(undefined),
  onOpenChange = vi.fn()
}: {
  initialName?: string
  isSubmitting?: boolean
  submitErrorMessage?: string | null
  onSubmit?: (name: string) => Promise<void>
  onOpenChange?: (open: boolean) => void
} = {}) => {
  render(
    <KnowledgeEntityNameDialog
      open
      title="重命名实体"
      submitLabel="提交"
      initialName={initialName}
      isSubmitting={isSubmitting}
      submitErrorMessage={submitErrorMessage}
      namePlaceholder="输入名称..."
      nameRequiredMessage="名称不能为空"
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )

  return {
    onSubmit,
    onOpenChange
  }
}

describe('KnowledgeEntityNameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefills the provided initial name', () => {
    renderDialog({ initialName: 'Research' })

    expect(screen.getByRole('heading', { name: '重命名实体' })).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('Research')
  })

  it('shows validation when the name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderDialog({ onSubmit })

    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
    expect(screen.getByText('名称不能为空')).toBeInTheDocument()
  })

  it('submits the trimmed name without closing on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    renderDialog({ initialName: 'Research', onSubmit, onOpenChange })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  Archive  ' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows the passed submit error message when submission fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))

    renderDialog({ initialName: 'Research', submitErrorMessage: '更新失败', onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
    expect(screen.getByText('更新失败')).toBeInTheDocument()
  })
})
