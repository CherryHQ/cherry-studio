import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeGroupNameDialog from '../KnowledgeGroupNameDialog'

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
          'common.add': '添加',
          'common.cancel': '取消',
          'common.name': '名称',
          'knowledge_v2.groups.add': '新建分组',
          'knowledge_v2.groups.rename': '重命名',
          'knowledge_v2.groups.rename_title': '重命名分组',
          'knowledge_v2.groups.name_placeholder': '输入分组名称...',
          'knowledge_v2.groups.name_required': '分组名称为必填项',
          'knowledge_v2.groups.error.failed_to_create': '分组创建失败',
          'knowledge_v2.groups.error.failed_to_update': '分组重命名失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const renderDialog = ({
  mode = 'create',
  initialName,
  isSubmitting = false,
  onSubmit = vi.fn().mockResolvedValue(undefined),
  onOpenChange = vi.fn()
}: {
  mode?: 'create' | 'update'
  initialName?: string
  isSubmitting?: boolean
  onSubmit?: (name: string) => Promise<void>
  onOpenChange?: (open: boolean) => void
} = {}) => {
  render(
    <KnowledgeGroupNameDialog
      mode={mode}
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

describe('KnowledgeGroupNameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the create mode title and submit label', () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: '新建分组' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
  })

  it('prefills the current group name in update mode', () => {
    renderDialog({ mode: 'update', initialName: 'Research' })

    expect(screen.getByRole('heading', { name: '重命名分组' })).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('Research')
    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument()
  })

  it('shows the group-specific required message when the name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderDialog({ onSubmit })

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
    expect(screen.getByText('分组名称为必填项')).toBeInTheDocument()
  })

  it('submits the trimmed group name in update mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    renderDialog({ mode: 'update', initialName: 'Research', onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  Archive  ' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
  })

  it('shows the create failure message when creation fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))

    renderDialog({ onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
    expect(screen.getByText('分组创建失败')).toBeInTheDocument()
  })

  it('shows the update failure message when renaming fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))

    renderDialog({ mode: 'update', initialName: 'Research', onSubmit })

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Archive')
    })
    expect(screen.getByText('分组重命名失败')).toBeInTheDocument()
  })
})
