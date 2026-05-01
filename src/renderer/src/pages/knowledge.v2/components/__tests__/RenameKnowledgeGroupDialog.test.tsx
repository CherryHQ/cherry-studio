import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RenameKnowledgeGroupDialog from '../RenameKnowledgeGroupDialog'

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
          'knowledge_v2.groups.rename': '重命名',
          'knowledge_v2.groups.rename_title': '重命名分组',
          'knowledge_v2.groups.name_placeholder': '输入分组名称...',
          'knowledge_v2.groups.name_required': '分组名称为必填项',
          'knowledge_v2.groups.error.failed_to_update': '分组重命名失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('RenameKnowledgeGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the explicit rename-group props into KnowledgeEntityNameDialog', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <RenameKnowledgeGroupDialog
        open
        initialName="Research"
        isSubmitting={false}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
    )

    expect(mockKnowledgeEntityNameDialog).toHaveBeenCalledWith({
      open: true,
      title: '重命名分组',
      submitLabel: '重命名',
      initialName: 'Research',
      isSubmitting: false,
      submitErrorMessage: '分组重命名失败',
      namePlaceholder: '输入分组名称...',
      nameRequiredMessage: '分组名称为必填项',
      onSubmit,
      onOpenChange
    })
  })
})
