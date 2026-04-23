import type { Group } from '@shared/data/types/group'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateKnowledgeGroupDialog from '../CreateKnowledgeGroupDialog'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean; [key: string]: unknown }) => (
    <button {...props}>{loading ? 'loading' : children}</button>
  ),
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  FieldError: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
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
          'knowledge_v2.groups.name_placeholder': '输入分组名称...',
          'knowledge_v2.groups.name_required': '分组名称为必填项',
          'knowledge_v2.groups.error.failed_to_create': '分组创建失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

describe('CreateKnowledgeGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not submit when the group name is empty', async () => {
    const createGroupMock = vi.fn().mockResolvedValue(createGroup())

    render(<CreateKnowledgeGroupDialog open isCreating={false} createGroup={createGroupMock} onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(createGroupMock).not.toHaveBeenCalled()
    })
    expect(screen.getByText('分组名称为必填项')).toBeInTheDocument()
  })

  it('closes the dialog on cancel without sending a request', () => {
    const createGroupMock = vi.fn().mockResolvedValue(createGroup())
    const onOpenChange = vi.fn()

    render(
      <CreateKnowledgeGroupDialog open isCreating={false} createGroup={createGroupMock} onOpenChange={onOpenChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('submits the trimmed group name and closes on success', async () => {
    const createdGroup = createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
    const createGroupMock = vi.fn().mockResolvedValue(createdGroup)
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()

    render(
      <CreateKnowledgeGroupDialog
        open
        isCreating={false}
        createGroup={createGroupMock}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    )

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  Archive  ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledWith('Archive')
    })
    expect(onCreated).toHaveBeenCalledWith(createdGroup)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows an inline error when the request fails', async () => {
    const createGroupMock = vi.fn().mockRejectedValue(new Error('boom'))

    render(<CreateKnowledgeGroupDialog open isCreating={false} createGroup={createGroupMock} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledWith('Archive')
    })
    expect(screen.getByText('分组创建失败')).toBeInTheDocument()
  })
})
