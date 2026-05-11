import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateKnowledgeGroupDialog from '../CreateKnowledgeGroupDialog'

const mockKnowledgeEntityNameDialog = vi.fn()

vi.mock('../KnowledgeEntityNameDialog', () => ({
  default: (props: unknown) => {
    mockKnowledgeEntityNameDialog(props)
    return null
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.add': '添加',
          'knowledge.groups.add': '新建分组',
          'knowledge.groups.name_placeholder': '输入分组名称...',
          'knowledge.groups.name_required': '分组名称为必填项',
          'knowledge.groups.error.failed_to_create': '分组创建失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('CreateKnowledgeGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the explicit create-group props into KnowledgeEntityNameDialog', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(<CreateKnowledgeGroupDialog open isSubmitting={false} onSubmit={onSubmit} onOpenChange={onOpenChange} />)

    expect(mockKnowledgeEntityNameDialog).toHaveBeenCalledWith({
      open: true,
      title: '新建分组',
      submitLabel: '添加',
      initialName: '',
      isSubmitting: false,
      submitErrorMessage: '分组创建失败',
      namePlaceholder: '输入分组名称...',
      nameRequiredMessage: '分组名称为必填项',
      onSubmit,
      onOpenChange
    })
  })
})
